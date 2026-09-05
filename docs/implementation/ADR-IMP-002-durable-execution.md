# ADR-IMP-002 — Durable execution for S1

**Status: ACCEPTED for S1.** Issued during S1A, 2026-09-04, on the evidence of the
kill-point matrix in `spikes/durable-execution/`.

**Amended 2026-09-04 during S1A.1 — S1A-H4.** The DECISION IS UNCHANGED. What changed is
the SCOPE OF THE CORRECTNESS CLAIM, narrowed on an owner review finding: this ADR
previously said the two candidates were *"equally correct"*, which is broader than the
evidence. The claim it is entitled to is that **both candidates were correct for the S1A
application-transaction/checkpoint property under test**. The ACOS step journal alone does
**NOT** provide external-effect exactly-once semantics. §7 states the limitation, names the
test that demonstrates it, and records why the fix belongs to S1's dispatch outbox rather
than to this spike.

**This is an IMPLEMENTATION decision.** It exercises the choice `34 ADR-002` left
explicitly open: *"DBOS Transact (MIT, v2.23.0, 2026-06-01) as primary — **provisional,
and subject to an S1 spike against an ACOS-owned Postgres step journal on the same
kill-point matrix**."* `31 §3.3`: *"DBOS remains the provisional recommendation; the
spike decides."*

---

## Decision

# SELECT ACOS POSTGRES STEP JOURNAL FOR S1

`34 ADR-002`'s reconsider trigger **(e)** is the one that fired: *"the S1 spike shows the
hand-rolled journal is simpler to attack and equally correct."*

**This is not a rejection of DBOS's correctness.** Both candidates were **correct for the
S1A application-transaction/checkpoint property under test**: at every kill point tested,
the ledger delta was applied exactly once across crash and recovery, the TB-04 coupling
survived, `journal_seq` stayed gap-free, and no ACOS invariant was weakened. The
discriminator is elsewhere, and it is stated precisely in §4.

**The scope of that claim is exactly as narrow as it reads, and §7 states its limit.**
Neither candidate was tested for — and the selected candidate does not provide —
external-effect exactly-once semantics. The trigger-(e) phrase *"equally correct"* is
`34 ADR-002`'s wording, quoted; the property this spike measured it against is the one
named above and no other.

---

## 1. What was measured, and how

`phase2-v1.3-implementation-brief.md §4` authorises the spike and adds the TB-04
interleavings to the matrix. The S1A mandate requires the same work item under both
candidates, seven kill points, and no inference from documentation where a local test is
possible.

**The same work item, shared verbatim.** `spikes/durable-execution/workItem.ts` holds one
copy of the four-step sequence; neither candidate reimplements it.

| Step | What it does |
|---|---|
| 1 `claim` | Idempotency claim on the work item |
| 2 `applyLedger` | **The ACOS application transaction**: declared lock order → TB-04's atomic realised-spend statement → gap-free `journal_seq` allocation, in ONE commit |
| 3 `dispatch` | A **mock** external effect |
| 4 `complete` | Mark done |

**Versions tested, pinned, not `latest`:**

| | |
|---|---|
| Candidate A | `@dbos-inc/dbos-sdk` **4.27.6**, `@dbos-inc/node-pg-datasource` **4.27.6** |
| Candidate B | `pg` **8.16.3**, ~90 lines in `spikes/durable-execution/candidateB-journal.ts` |
| Substrate | PostgreSQL **16.9** |

**A version finding, recorded rather than smoothed over.** `34 ADR-002` pins DBOS
**v2.23.0 (2026-06-01)**. The current published version is **4.27.6** — two majors on, and
the API named in the ADR no longer matches: transactions are now registered through a
**data source** package (`@dbos-inc/node-pg-datasource`) that did not exist under the
pinned version. The ADR's pin is stale, and an implementation following it literally would
have been evaluating a version nobody ships. This does not change the decision; it is
recorded because `34 ADR-002`'s reconsider trigger (d) is about DBOS release velocity and
this is a data point on it.

**Kills are real.** `spikes/durable-execution/child.ts` runs each candidate in a separate
OS process which `SIGKILL`s itself at the named point. No `finally` runs, no connection
closes politely.

**A harness defect in the ORIGINAL S1A run, recorded and not erased — S1A-H1.** Candidate
A needs a DBOS **system database**, `acos_dbos_sys`. `docker compose up` creates
`acos_control` and `acos_audit` and nothing else, and the spike derived the system URL from
`ACOS_AUDIT_PG_URL` by string substitution. From a genuinely clean environment that
database does not exist, and **five candidate-A tests failed with
`3D000: database "acos_dbos_sys" does not exist`**. The original S1A run's candidate-A rows
below were obtained only after that database had been **created by hand**. That is a
test-harness reproducibility defect — not a money-path defect and not a DBOS semantic
failure — and it is repaired in S1A.1: `tests/support/localPostgres.ts` provisions the
database on both providers and returns its URL, `globalSetup.ts` publishes it, and the
spike reads it. `npm run db:down && npm run db:up && npm test` now needs no manual SQL.
Regression assertion: `tests/integration/harness/dbos-system-database.test.ts`. Recorded in
`S1A-implementation-log.md §16`.

---

## 2. The kill-point matrix

Every cell is measured. `realised` is the ledger delta; `standing` is the trigger-maintained
`window_balance.standing_monetary`; `nextSeq` is the gap-free counter; `dispatch` is the
count of mock external effects.

Fixture: ceiling `$186.00`, one LIVE authorisation at `standing_cap = $100.00`,
observation delta `$40.00`. Correct final state: `realised=40.00 standing=60.00 nextSeq=2
dispatch=1`.

### Candidate B — ACOS-owned Postgres step journal

| # | Kill point | DB after kill | Workflow after kill | Recovery | Duplicates | Invariant weakened |
|---|---|---|---|---|---|---|
| — | none (baseline) | `COMPLETE realised=40.00 standing=60.00 nextSeq=2 dispatch=1` | `SUCCESS steps=[applyLedger,claim,complete,dispatch]` | n/a | 1 | **none** |
| 1 | before the transaction begins | `CLAIMED realised=0.00 standing=100.00 nextSeq=1 dispatch=0` | `RUNNING steps=[claim]` | re-run same id → correct | 1 | **none** |
| 2 | after locks acquired | `CLAIMED realised=0.00 standing=100.00 nextSeq=1 dispatch=0` | `RUNNING steps=[claim]` | re-run same id → correct | 1 | **none** |
| 3 | after rows change, before commit | `CLAIMED realised=0.00 standing=100.00 nextSeq=1 dispatch=0` | `RUNNING steps=[claim]` | re-run same id → correct | 1 | **none** |
| 5 | after durability/checkpoint state | `CLAIMED realised=0.00 standing=100.00 nextSeq=1 dispatch=0` | `RUNNING steps=[claim]` | re-run same id → correct | 1 | **none** |
| 4 | immediately after commit | `LEDGER_APPLIED realised=40.00 standing=60.00 nextSeq=2 dispatch=0` | `RUNNING steps=[applyLedger,claim]` | re-run same id → correct | 1 | **none** |
| 6 | during retry/recovery | covered by the recovery column of every row above | | | | **none** |
| 7 | concurrent retry of the same work item | `COMPLETE realised=40.00 standing=60.00 nextSeq=2 dispatch=1` | `SUCCESS` | one process lost the claim race and exited non-zero | 1 | **none** |
| — | TB-04, reconciler first | `realised=40.00 standing=60.00` | concurrent authorisation PERMIT | n/a | 1 | **none** |
| — | TB-04, authorisation first | `realised=40.00 standing=60.00` | concurrent authorisation PERMIT | n/a | 1 | **none** |

**Row 5 is candidate B's central result and it is not a coincidence of ordering.** For
candidate B, *"after the checkpoint"* and *"before the commit"* are **the same instant**,
because the step-journal row is written by the same connection inside the same
`BEGIN`/`COMMIT` as the ledger. A kill there leaves nothing — no ledger movement, no
sequence allocation, **and no checkpoint**. The spike asserts the last part explicitly: the
step journal does not contain `applyLedger` for a transaction that never committed. There
is no state in which the durability layer believes the step completed and the ledger
disagrees, because one commit decides both.

### Candidate A — DBOS Transact

| # | Kill point | DB after kill | Workflow after kill | Recovery | Duplicates | Invariant weakened |
|---|---|---|---|---|---|---|
| — | none (baseline) | `COMPLETE realised=40.00 standing=60.00 nextSeq=2 dispatch=1` | `dbos` schema in the **application** db: `[transaction_completion]` | n/a | 1 | **none** |
| 3 | after rows change, before commit | `CLAIMED realised=0.00 standing=100.00 nextSeq=1 dispatch=0` | status in the **system** database | re-run same id → correct | 1 | **none** |
| 5 | after durability/checkpoint state | `CLAIMED realised=0.00 standing=100.00 nextSeq=1 dispatch=0` | status in the **system** database | re-run same id → correct | 1 | **none** |
| 4 | immediately after commit | `LEDGER_APPLIED realised=40.00 standing=60.00 nextSeq=2 dispatch=0` | status in the **system** database | re-run same id → correct | 1 | **none** |
| — | checkpoint location (structural) | `dbos.transaction_completion` **exists in the application database** | workflow status and step outputs live in the **system database** | n/a | n/a | transaction step shares the application commit; **workflow state does not** |
| — | **system-db lifecycle divergence** | after an application-database restore: `PENDING realised=0.00`; after re-running the same workflow id: **still** `PENDING realised=0.00` | system db still holds the workflow as complete | **NOT RE-EXECUTED** — the process reports success and the ledger stays untouched | 0 | no ACOS invariant is violated, **but the work silently did not happen** |

---

## 3. The property ACOS actually needs, and whether DBOS has it

**It does.** `@dbos-inc/node-pg-datasource` writes `dbos.transaction_completion` **into the
application database, inside the user's transaction**. The first-party documentation states
it as *"atomically committing both user-defined changes and a DBOS checkpoint"*, and the
spike confirmed the table's presence in `acos_control` rather than only in the system
database. The datasource also exposes the raw `pg` client, so `SELECT … FOR UPDATE`, the
declared lock order, `SERIALIZABLE`, and the K5 triggers all work unchanged — the spike ran
**the same `stepApplyLedger` function** under both candidates.

So the S1A mandate's narrow question — *"Does DBOS preserve or materially complicate
ACOS's Postgres transaction semantics compared with an ACOS-owned step journal?"* —
answers in two parts:

- **Preserve: yes**, for the transaction step. R1 is intact. `phase2-v1.3-implementation-brief.md §7`
  condition 7 is **NOT** triggered by either candidate.
- **Complicate: yes**, for everything around it. That is §4.

---

## 4. What decided it

### 4.1 DBOS's durable state lives in two places; ACOS's ledger lives in one

DBOS keeps durable state in **two stores**, and the spike had to discover this to make its
own tests deterministic:

1. `dbos.transaction_completion` — in the **application database**, but in the `dbos`
   **schema**, which `DROP SCHEMA public CASCADE` does not touch.
2. `dbos.*` in the **system database** — workflow status, step outputs, queues. A separate
   database entirely, addressed by `systemDatabaseUrl`.

Neither is cleared by resetting the application's own data. The spike therefore needed a
`resetDbosState()` function that reaches into both. **Candidate B needs no equivalent**:
its step journal is an ordinary table in `public`, dropped with everything else, and it
cannot be out of step with the ledger it describes.

### 4.2 The measured consequence

The row that decided this ADR is **SYSTEM-DB LIFECYCLE DIVERGENCE**, measured directly:

1. Run the work item to completion under DBOS. The ledger moves: `realised = 40.00`.
2. Restore **only** the application database — the ordinary shape of a restore, a branch
   reset, a migration rollback or a test-environment refresh.
3. Re-run the **same workflow id**.

**Result: the work is not re-executed, the process reports success, and the ledger stays at
`0.00`.**

DBOS is behaving correctly by its own contract — a completed workflow id is not
re-executed. The problem is that the contract is evaluated against a store whose lifecycle
is not coupled to the ledger's. For a money path whose entire safety argument is *"one
database, one transaction, one commit point"*, a second durable store that can disagree
with the first about whether money moved is a **coupling** cost, not a correctness bug.

`33 §1.1` is the section this bears on: the argument for Option A does not depend on DBOS,
and *"an Option A that abandons DBOS is still Option A."* Taking the step journal keeps
every durable fact about the money path in one database with one lifecycle.

### 4.3 The rest of the criteria, as measured

| Criterion | Candidate A — DBOS 4.27.6 | Candidate B — ACOS step journal |
|---|---|---|
| Preserves the ACOS application transaction | **Yes** — raw `pg` client, real `FOR UPDATE`, real `SERIALIZABLE`, K5 triggers unaffected | **Yes** — it *is* the ACOS transaction |
| Checkpoint semantics | Transaction completion in the app db, inside the commit. Workflow state in the system db, outside it | One row, inside the commit. Nothing outside it |
| Crash recovery | Correct at every kill point tested | Correct at every kill point tested |
| Duplicate prevention, **ledger** | Exactly once across every kill + recovery | Exactly once across every kill + recovery |
| Duplicate prevention, **external effect** | Not provided; not claimed. `31 §3.1` | Not provided; not claimed. **§7** |
| Kill-point behaviour | No partial ledger state at any point | No partial ledger state at any point; kill points 3 and 5 **collapse to one instant** |
| Operational complexity | Two databases to provision, back up, restore **together**, and migrate. A `dbos` schema in the app db that survives an app-data reset | One table. Backed up, restored and migrated with the ledger because it is in the ledger's database |
| Coupling | Workflow functions must be registered under stable names before `launch()`, and the recovering process must register the same names. A framework lifecycle wraps the process | A function call. No registration, no launch, no lifecycle |
| Debugging | Workflow state is in another database; correlating a stuck workflow with a ledger row is a cross-database join done by hand | `SELECT * FROM acos_step_journal WHERE workflow_id = …`, in the same session as the ledger query |
| Migration burden | Two majors since the ADR's pin, with the transaction API relocated to a new package. Upgrades touch the money path's execution wrapper | ~90 lines of ACOS code with no upstream |
| Admin/replay surface | `31 §3.4` (SPO-08) requires the workflow-management surface — including `fork`, which re-drives from a chosen step — to be **disabled or network-isolated**, and asserted as a test. That is an ongoing obligation | No admin surface exists to close |
| Interaction with the lock order | None observed. The declared order was taken unchanged inside the DBOS transaction | None. Same helper, same order |
| Interaction with transaction retries | `SERIALIZABLE` still produces `40001` and still needs the ACOS-owned retry (`S1A-implementation-log.md §8`). DBOS does not remove that obligation | Identical |

**Neither candidate closes the crash-during-dispatch window**, exactly as `31 §3.1` says:
*"an incomplete step is not a checkpointed step."* Both matrices show `dispatch=0` after a
kill at commit, with the dispatch happening on recovery. `23 §6` B8 and `25 §7` are
unchanged: duplicate prevention at the dispatch boundary rests on vendor idempotency, a
vendor query, or **ACOS's own outbox claim** — which is ACOS-owned either way, per
`phase2-v1.3-implementation-brief.md §4` and `33 §1.1`.

**And the selected candidate does not close a second, wider hole either — the CONCURRENT
one.** §7 states it, and it is measured rather than reasoned about.

### 4.4 The argument that did NOT decide it

**Not throughput.** `34 ADR-002`: *"Throughput alone is not a trigger."* Not measured, not
used.

**Not "DBOS is provisional so drop it".** The S1A mandate: *"Do not choose DBOS merely
because the architecture called it provisional primary."* The inverse applies equally. The
spike ran DBOS to completion, killed it three ways, recovered it three ways, and it passed
every one.

**Not Temporal.** `31 §3.2` and `31 §3.3`: taking Temporal *"moves the checkpoint out of
Postgres and destroys R1"* and is *"an explicit return to Option B"*. It was outside the
spike and is not considered here.

---

## 5. What ACOS owns as a result

**Everything.** With the step journal selected, the durability layer is:

| Responsibility | Owner | Location |
|---|---|---|
| Step completion record | ACOS | `acos_step_journal`, application db, inside the ledger transaction |
| Workflow status | ACOS | `acos_workflow`, application db |
| Never-re-execute guarantee | ACOS | `completedStep()` read + `ON CONFLICT DO NOTHING` insert |
| Recovery | ACOS | Re-running the workflow **is** recovery; checkpointed steps replay |
| Retry on `40001` | ACOS | `src/kernel/exposure/retry.ts` |
| Dispatch outbox | ACOS | S4, and `33 §1.1` says it was always ACOS-owned |
| Gap-free `journal_seq` | ACOS | `journal_counter` row — *"a property of the substrate and not of the workflow engine"* (`phase2-v1.3-implementation-brief.md §4`) |

**The obligations this creates, stated so they are not discovered later.** A step journal
is not free; it is cheap, which is a different claim. Every item below is **carried forward
unchanged into S1** and is re-declared here after the S1A.1 review. ACOS must now build,
and did not build in S1A:

1. A **scheduler/dequeuer** — DBOS supplies queues; ACOS must supply an equivalent for S1's
   work orchestrator (`33 §4`'s `work` module, K7).
2. **Recovery detection** — something must notice a workflow stuck in `RUNNING` after a
   process death. S1A re-ran recovery by hand from the test.
3. **Step-output serialisation discipline** — `jsonb` in the spike. `30 §5.3`'s
   `ACOS-JCS-1` governs the *journal* chain, not this table, but the two must not be
   confused when S1 builds the chain.
4. **EXCLUSIVE WORK-ITEM CLAIM / LEASE SEMANTICS** — kill point 7 showed one of two racing
   processes exiting non-zero, and §7's negative control shows the generic step wrapper
   admits two concurrent workers outright. The ledger stayed correct in both cases, but a
   production dequeuer needs an exclusive claim with a lease, and it must not surface a
   lost race as a process failure.
5. **THE ACOS-OWNED DISPATCH OUTBOX** — the thing that actually provides external-effect
   exactly-once, per `23 §6` B8, `25 §7` and `33 §1.1`, together with vendor idempotency.
   S4 in `37`'s sequence. **This obligation is load-bearing for §7's limitation and is not
   optional.**

**None of these is on the money path**, which is why they are acceptable as S1 work rather
than S1A blockers. Item 5 is the one a reader must not mistake for something the step
journal already does.

---

## 6. Consequences and the conditions that would reverse this

**Reversal condition 1.** If S1's work orchestrator turns out to need queueing, scheduling
and recovery machinery whose ACOS implementation approaches DBOS's in size, the
simplicity argument in §4.3 is gone and DBOS should be reconsidered — it passed every
correctness test here and would be adopted with no correctness concern.

**Reversal condition 2.** If DBOS gains the ability to keep its workflow state in the
application database, §4.1's coupling objection disappears and the spike's central finding
with it.

**Reversal condition 3.** `34 ADR-002`'s own triggers (b) and (c) — a second operating
business, or workflows routinely exceeding 30 days — remain Temporal triggers and remain
an explicit return to Option B requiring a new ADR. Unchanged by this decision.

**What this does NOT authorise.** No production deployment. No real adapters. The spike's
step 3 is a mock, so `31 §3.3`'s VAL-04 requirement — that vendor behaviour be tested
against vendor sandboxes — is **not satisfied**, and this ADR makes no claim about vendor
idempotency. That measurement belongs to S3 with `refundCreate` and the ESP, and
`phase2-v1.3-implementation-brief.md §6` obligations 7 and 11 still stand unmet.

**Amendment to `34 ADR-002`.** This ADR is an implementation decision and does not rewrite
the architecture. `34 ADR-002`'s status is `PROVISIONAL` and its reconsider trigger (e) has
now fired with evidence. Whether the architecture record is amended is an architecture
action, not an implementation one; recorded here for the owner's review.

---

## 7. S1A-H4 — what the step journal does NOT provide: external-effect exactly-once

**An owner review finding, recorded as a narrowing of this ADR rather than as a change to
its decision.** Read with §5 obligations 4 and 5, which are what actually discharge it.

### 7.1 The shape of the generic step wrapper, and the hole in it

`spikes/durable-execution/candidateB-journal.ts`'s generic `runStep()` is:

```
read completed checkpoint  →  perform step  →  record completed checkpoint
```

Two things follow, and only the first was previously stated:

1. **The crash window.** A process that dies between the effect and the checkpoint has
   performed the effect with no record of it. This is `31 §3.1`'s window, which DBOS
   *"narrows but does not close"* either, and the kill-point matrix shows it for both
   candidates.
2. **THE CONCURRENCY HOLE, which is wider.** For a nontransactional or external effect,
   **two truly concurrent workers can both pass the first read before either records the
   checkpoint**, and both then perform the effect. No claim is taken. Nothing prevents it.
   No crash is required.

### 7.2 The negative control, measured

`spikes/durable-execution/external-step-race.test.ts` demonstrates it deterministically,
driving the real `runStep` through a barrier rather than a reimplementation of it:

| | Measured |
|---|---|
| Two concurrent workers, both parked after the checkpoint read, then released together | **`dispatch = 2`** — the mock external effect happened TWICE |
| Both workers' outcomes | **`fulfilled`, `fulfilled`** — nothing failed, so the duplicate is silent |
| Step-journal rows for the step | **exactly one** — `ON CONFLICT DO NOTHING` deduplicates the RECORD, not the EFFECT |

**The journal therefore reports one dispatch where two happened.** That is the precise
shape of the limitation, and it is why the outbox is not a nicety.

**The lesson is `raw step journal + unclaimed external step is insufficient`. It is NOT
`fix runStep into the production dispatcher`.** S1A does not build the production
orchestrator; the S1A mandate prohibits it, and `23 §6` B8, `25 §7` and `33 §1.1` already
assign external exactly-once to an ACOS-owned dispatch outbox with an exclusive claim,
plus vendor idempotency.

### 7.3 The contrast, measured in the same file, with the same race

The same barrier-driven race applied to `applyLedgerStep()` — where the checkpoint is
written **inside** the ledger transaction — behaves differently, and the difference is the
whole reason this ADR selects what it selects:

| | Measured |
|---|---|
| Concurrent applications that committed | **exactly one** |
| The loser's failure | **`40001`**, from its `SELECT … FOR UPDATE` on a `window_balance` row the winner had already committed (`S1A-implementation-log.md §8`) — fail-closed, nothing committed, no journal gap |
| Deadlock | **none** — `40P01` explicitly asserted absent |
| `realised` | **`40.00`** — applied exactly once |
| `standing` | **`60.00`** — the TB-04 coupling held |
| `journal_seq` | **`nextSeq = 2`** — no second allocation, no gap |
| Step-journal rows | **exactly one**, written by the transaction that committed the ledger |

Note **what protects the ledger here: the SUBSTRATE, not the journal.** The row lock plus
`SERIALIZABLE` refuse the second application. The journal's contribution is that its
checkpoint cannot disagree with the ledger, because one commit decides both.

### 7.4 Consequence for the decision

**None. The winner does not change.**

# SELECT ACOS POSTGRES STEP JOURNAL FOR S1

The reversal condition this finding would have to satisfy is a defect in the
**application-transaction checkpoint property** itself, and §7.3 shows that property
holding under exactly the race that breaks the generic external step. The two results are
independent, and only the narrower one was ever the basis of the selection.

What changes is the language. Everywhere this ADR previously implied a general correctness
equivalence, the claim is now: **both candidates were correct for the S1A
application-transaction/checkpoint property under test.** The ACOS step journal alone does
not provide external-effect exactly-once semantics, and this ADR does not claim that it
does.
