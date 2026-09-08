# S1I — Implementation Log

Chronological, with the decisions that were genuinely open and the reason each was closed
the way it was.

---

## 1. Baseline evidence

```
$ git rev-parse HEAD
8ce0d4121b46d765afe0d8f0c5d6afae5811386f

$ git status --porcelain
(clean)

$ npm run verify
Test Files  109 passed (109)
     Tests  1679 passed (1679)
  Duration  596.52s
[exited with code 0]

$ git checkout -b feature/s1i-durable-outbox-claim
Switched to a new branch 'feature/s1i-durable-outbox-claim'
```

109 files, 1679 tests, 1679 passing, 0 failed, 0 skipped, typecheck green, lint at
`--max-warnings 0`. Matches the mandate's declared accepted state exactly.

---

## 2. The architecture read, before any code

`§1` of the mandate lists the sections to inspect. What each settled:

| Section | What it settled |
|---|---|
| `25 §7` | The outbox's full specification in four sentences: one row per intended message, unique on the effect idempotency key, a provider-visible correlation tag, `CLAIMED` in a committed transaction before the HTTP call, never re-dispatched by any path. |
| `34` ADR-026 | The same, plus the recoverability-keyed unknown-outcome table and the `NEVER_SENT`-needs-fresh-authorisation rule. |
| Registry `I36` | Enforcement **"DB (state machine constraint)"**; verification **"kill at each of the six points in `44 §5.2` against the real ESP sandbox"**; slice **S4**. The split between what S1I can close and what it cannot follows from this one row. |
| `30 §5.1` item 3 | The authorising transaction's write list, exhaustively — **and no outbox row in it.** Settled `§26`. |
| `23 §6` B8 | *"dispatch follows the commit, by recoverability class."* The same answer in prose. |
| `24 §4` ERD | `EFFECT ||--o| OUTBOX_ROW` — zero or one. An effect with no outbox row is legal. The same answer as a cardinality. |
| `30 §5.1` item 4, `22 §3.1` | The ordered first-match precedence list, state-qualified. Row 1 halts IRRECOVERABLE in **all three** states — the finding in `S1I-C6`. |
| `30 §5.1a` | The three declared quantities: the $20.00 floor (strict, against `total_exposure`), `PT15M`, `PT30M`, and the FULL-HALT POSTURE's semantics. |
| `30 §5.7.2` | The override's shape, scope rule, and item 3's "incremented in the dispatching transaction" — the ambiguity in `S1I-C3`. |
| `26 §5` | Recoverability is catalogue-assigned, never per request, never by a model. |
| `26 §2.1` | `dispatch_payload_hash` "binds this request to exactly one dispatch payload", and **no payload column is declared** — the reason the bytes have to arrive at enqueue time. |
| `33 §1` | The adapter receives the payload **verbatim** and constructs nothing. The whole of `§9`/`§10`. |
| `48` | The external-write perimeter. Every `REQUIRED` row is an adapter or a gateway-dispatched effect; S1I adds no call site of either kind. |
| `36 §5` | The six outbox kill points, and that they are measured by the **provider's own accepted count**. |
| `30 §9.1` | The clock contract — and the absence that became `S1I-C1`. |
| `50 §2` class 20 | The journal canonicalisation specification, and therefore the signature obligation a new row kind extends. |
| `37 §2` S4 | The outbox is scheduled at S4. `S1I-C7`. |

---

## 3. `§26` decided from the architecture, not from convenience

The mandate is explicit that this must not be decided on convenience, so the decision was
made from three independent passages that agree:

1. `30 §5.1` item 3 prints the authorising transaction's writes as an exhaustive block, and
   S1F implements it statement for statement. No outbox row appears.
2. `23 §6` B8 states the ordering in prose: *"dispatch follows the commit."*
3. `24 §4`'s ERD gives the cardinality as zero-or-one, which under reading (A) it could not
   be.

**So the architecture chooses (B): a post-commit derivative. The accepted S1F transaction is
not touched by this slice.** What (B) obliges is the recoverable derivation, and
`dispatch_outbox_missing` plus `recovery.ts` are it. `outbox-crash-matrix.test.ts` proves the
kill point in both directions: the work is discoverable on every restart, and the recovery
creates one row with no second economic authorisation.

---

## 4. `0010__dispatch_outbox.sql` — the decisions inside it

### The primary key is the idempotency identity, not the surrogate

`33 §6` states the property for the sibling table and the reasoning transfers verbatim:
*"`effects` primary key includes the idempotency key with a unique constraint (I42), so a
duplicate proposal cannot create a second row **even if every layer above it fails**."*

Making `outbox_id` the primary key and the idempotency key merely unique would satisfy the
words and put the duplicate-prevention property on a secondary index. Making the identity
THE key means a second row for one intended effect is not a rejected insert — it is an
unrepresentable state.

### Every authority column is a foreign-key member

`§8`'s attack is `outbox(effect_id = X, payload = payload-for-Y)`. The mechanism against it
is a COMPOSITE FOREIGN KEY rather than a lookup:

```sql
FOREIGN KEY (effect_id, company_id, idempotency_key, authorisation_id,
             action_class, recoverability, adapter, resource_ref, effect_status)
  REFERENCES effect (effect_id, company_id, idempotency_key, authorisation_id,
                     action_class, recoverability, adapter, resource_ref, status)
```

A mismatched tuple has no INSERT at all — there is no code path, trusted or otherwise, that
can write one. **`effect_status` is a member deliberately:** `effect` is append-only, so an
effect's status is fixed at commit, and including it means an `AWAITING_APPROVAL` effect has
no enqueue path while `26 §12`'s resume is unbuilt.

Both reference targets are unique indexes over a SUPERSET of an already-unique column, so
neither adds a constraint to an accepted table.

### The payload↔hash binding is a DATABASE CHECK

```sql
CONSTRAINT dispatch_outbox_payload_binds_hash
  CHECK (dispatch_payload_hash = encode(sha256(payload_canonical_bytes), 'hex'))
```

**This is why the payload is stored as `BYTEA` and not as JSONB.** A JSONB column would have
needed an RFC-8785 implementation in SQL to bind it to the hash; bytes need only `sha256`,
which PostgreSQL has natively, and the binding therefore becomes a database property rather
than an application convention. It also keeps `§42`'s STOP condition unreached: no
production journal row and no production outbox column carries JSON.

Composed with the FK to `authorisation (authorisation_id, dispatch_payload_hash)`, the two
say: the bytes on this row hash to the hash on this row, AND that hash is the one the
committed authorisation bound. Neither alone would suffice — the CHECK would accept a
self-consistent pair from another effect, and the FK would accept the right hash beside the
wrong bytes.

### The state machine is a trigger, because a CHECK cannot see `OLD`

The property is about the TRANSITION. `0003`'s `standing_authorization` transition table set
the precedent in this schema. Four properties, in this order:

* `DELETE` refused on both statuses — a deleted row is a re-enqueueable duplicate.
* `OLD.status = 'CLAIMED'` → **no UPDATE at all.** Not a status change, not a column touch,
  not a lease reset, not a re-claim. So `§19`'s "restart does not make it claimable" and
  "lease timeout does not make it claimable" are not behaviours of the claim service; they
  are absences in the schema.
* The only admissible `NEW.status` is `CLAIMED`.
* The identity, the payload and the correlation tag compare EQUAL across the transition,
  column by column, so the refusal names what moved.

### `claim_matched_row` is CHECKed to {3, 4, 5}

`22 §3.1` prints rows 1 and 2 as Halt in all three states and `30 §5.1` item 5 makes them
unreachable by override. So no claim can have been decided by row 1 or 2, and a row
recording one is not a state this system produces. A second refusal on top of the claim
service's own, for the reason `36 §0` gives about single-mechanism properties.

### `claim_override_id` is a FOREIGN KEY, not a boolean

`§31`: *"Do not merely persist `overrideApplied = true`. Bind the exact authoritative
override identity."* A boolean could not be a foreign key, so the reference TYPE is the
property. Two further CHECKs follow from `30 §5.7.2` item 5 and `30 §5.1` item 5: an
override-backed claim always carries the tag requirement, and it can only have matched row
3 or 4.

---

## 5. `dispatchPayloadCanonicalBytes` — a production export, and why it is not a widening

S1B and S1F persisted the payload's HASH and not its bytes, correctly: `26 §2.1` declares
`dispatch_payload_hash` and declares no payload column. But the canonical effect now has to
cross an ASYNCHRONOUS boundary, and a hash cannot be carried across one — a future
dispatcher holding only a digest would have to rebuild the request from whatever state is
current when it runs, which is exactly the reconstruction `33 §1` forbids.

So `canonicaliser.ts` gained one export and one refactor:

* `dispatchPayloadStructure(payload)` — the declared field order, written once.
* `dispatchPayloadCanonicalBytes(payload)` — `canonicalBytes` over that order.
* `dispatchPayloadCanonicalHash(payload)` — now `canonicalHash` over the SAME order.

**No new commitment and no second field order.** The hash is `sha256` of the bytes function's
output, so the two cannot diverge, and every previously computed hash is byte-identical. The
accepted `hash-binding.test.ts` still asserts that an edit reordering the literal cannot move
the hash, and it now covers the bytes as well.

---

## 6. The claim's operand resolution, and the one that stopped

Every operand `30 §5.1` item 4 reads is read INSIDE the claim transaction, from the
authoritative table:

| Operand | Source |
|---|---|
| `mirrorState`, `unreachableSince` | `mirrorDispatchOperandsOn` — read as a coherent pair, which is why the accepted function exists |
| `actionClass`, `recoverability` | the committed `effect` row |
| `totalExposure` | the committed `authorisation` row |
| `hasRecordedApproval` | the `approval` table |
| `activeOverride` | `activeOverrideOn` |
| `now` | the caller's instant; the control database clock on the money path (`36 §6`) |
| `clockBearing` | **`clockBearingAtClaim()` — `false`. See below.** |

**`clockBearing` STOPPED.** `30 §5.1` row 3's operand is keyed on
`statutory_clock.case_ref`, and v1.3.3 declares no binding from an effect to a `case_ref`.
`S1I-C1` carries the passages. The function takes no arguments and returns a constant,
because a parameter would be the escape hatch `26 §1` Corollary 3 forbids and a lookup on a
guessed `case_ref` would be the lever `30 §9.1` exists to close. **The row-3 claim-time leg
is reported PARTIAL.**

`hasRecordedApproval` is structurally `false` at S1I — `approval` rows exist only for
`AWAITING_APPROVAL` effects, only `AUTHORISED` effects can be enqueued, and the resume that
would connect them is unbuilt — but it is read from the table anyway, so the operand is
correct by construction rather than by an argument about what cannot happen.

---

## 7. The exclusion mechanism, and what was rejected

`SELECT … FOR UPDATE` on the outbox row, then a re-read of `status` **under that lock**, then
the `UPDATE` with `AND status = 'ENQUEUED'`.

`§17` forbids the alternatives by name and none is present: no JavaScript mutex, no process
singleton, no in-memory lock, no reliance on a sequential test.

**`READ COMMITTED` was chosen over `SERIALIZABLE` deliberately.** At the higher levels the
loser's `FOR UPDATE` raises `40001` instead of reading the new row version — also safe, but
it converts a determinate `ALREADY_CLAIMED` into a retryable error a caller must interpret,
and `§44` requires the retry not to produce a second claim. `33 §6` scopes the serialisable
requirement to the exposure ledger, *"the only table with a serialisable-isolation
requirement"*, and the claim moves no money. The accepted `retry.ts` is untouched and the
outbox directory owns no retry policy — `outbox-crash-matrix.test.ts` asserts `40P01` and
`DEADLOCK` are absent from it.

**Lock order** follows `lockOrder.ts`'s resolution of `30 §5.2`: no `window_balance`, no
`standing_window_exposure`, then the outbox row, then the override row, then
`journal_counter` last inside the emitters. The same order the accepted
`claimOverrideAllowanceOn` already takes, and no inversion against the S1F transaction is
possible because that transaction never touches `dispatch_outbox`.

---

## 8. Journaling the claim, and not journaling the enqueue

`23 §6` B8: *"Effect ↛ External without journal [...] No effect originating in reasoning can
occur that is not recorded."* The claim is the instant ACOS durably commits that this effect
may leave, so it is the last local record before an external effect could exist.

**One new row kind, on the same chain.** `OUTBOX_CLAIMED`, on `effect_journal`, the same
`journal_counter`, the same `effect_journal_chain` trigger, the same replication path — for
the reason 0008 and 0009 both gave: a second table would be `30 §5.4`'s *"second unverified
channel"*. And it MUST reach the audit plane, because `I17` is a two-sided diff and `30 §5.2`
gives a missing `journal_seq` *"exactly one interpretation"*.

**The enqueue is not journaled.** It moves no authority, creates no reservation, changes no
exposure and makes nothing eligible; its subject is already in a committed, chained
`EFFECT_AUTHORISATION` row; and the outbox row is itself durable, discoverable state. `§42`
says implement only what scope requires, and v1.3.3 requires none for enqueue.

**A refused claim is not an event.** The accepted `claimOverrideAllowanceOn` already
establishes the rule — it evaluates every bound BEFORE emitting — and a refused claim writes
nothing at all, which is what makes `§14`'s reverse case work.

**Class 20's signature obligation is extended, and disclosed.** A new row kind adds a column
order to `50 §2` class 20's specification and therefore moves its `content_hash`. That
signature was already owed at v1.3.2 and is still owed. Nothing here is signed.

---

## 9. Six problems found while building, and how each was resolved

**(a) The audit migration left the owner role set.** `A0005` opened with `SET LOCAL ROLE
acos_audit_owner` and did not `RESET ROLE`, so the migration runner's own write to
`audit_schema_migration` failed with `42501`. A0002 and A0004 both end with `RESET ROLE`;
A0005 now does too.

**(b) `A0005` had to reproduce A0004's handler, not A0002's.** The ingest function is
re-declared at a wider signature, and A0004 had appended `30 §5.7.1a`'s three-SQLSTATE
store-write-availability handler after A0002's. Dropping it would have silently removed an
accepted behaviour that `store-write-availability.test.ts` asserts. It is carried forward
verbatim, with a comment saying so.

**(c) Two negative controls deadlocked the test, not the database.** Both issued
`CREATE TABLE IF NOT EXISTS` inside the racing transaction. That statement takes an
`ACCESS EXCLUSIVE` lock and holds it to commit, so racer B blocked on racer A's create while
A was parked at the barrier waiting for B. Both controls now expose an
`ensure…()` function called in its own transaction before the race. Recorded because the
symptom — a hung suite rather than a failing assertion — is easy to misdiagnose as a
production deadlock.

**(d) The audit chain hash is not `sha256(canonical bytes)`.** A0001 computes
`audit_row_hash = sha256(framed(audit_prev_hash) || framed(canonical bytes))`, in ARRIVAL
order, *"because a store that can hold a gap cannot chain by a sequence it does not have"*.
The first draft of `outbox-journal-rows.test.ts` asserted the simpler form and failed. The
assertion now reconstructs A0001's construction from the oracle's own `frameField`.

**(e) The `§35` regression flagged an accepted write.** The first draft asserted that no
module in `src/` issues `UPDATE mirror_declaration`. The accepted `closeMirrorDeclaration`
does, and `30 §5.1a` requires it: *"leaving the degraded path journals the close and sets
`closed_at`."* The property is not "no UPDATE to the table" — it is that no UPDATE names
`opened_at`, which is the column the FULL-HALT timer reads and the one `§35`'s residual is
about. The check now examines each `UPDATE mirror_declaration` statement individually.

**(f) The override race needed two effects the fixture could not yet produce.** Two refunds
distinguished only by `sessionId` were DENIED at the pre-reservation gates, because the
second session was not seeded. Rather than widen the fixture's session seeding — which would
have changed an accepted world for a test's convenience — the race uses two
`authoriseRefundAtExposure` effects on distinct resources, each a genuinely different
semantic effect identity. The same helper supplies `30 §5.1a`'s `$20.00`/`$20.01` boundary
cases.

---

## 10. `§52`'s diff audit, performed against `git diff 8ce0d41...HEAD`

| Looked for | Found |
|---|---|
| network / vendor code | **NONE.** `no-transport-boundary.test.ts` asserts it over the outbox directory with 23 patterns, and over `src/` for adapters and vendors. |
| auto claim scheduler | **NONE.** No timer, loop, `LISTEN`/`NOTIFY` or worker; asserted. |
| reclaim timeout | **NONE.** No `claim_expires_at`, lease column or attempt counter; asserted against `information_schema`. |
| caller-supplied recoverability | **NONE.** No parameter; composite FK; compile-negative. |
| caller-supplied payload | **The bytes are supplied and CHECKED.** Only the already-authorised bytes are acceptable — CHECK plus FK. |
| caller-supplied dispatch eligibility | **NONE.** No parameter, no column; compile-negative. |
| mutable payload after enqueue | **NONE.** Refused on both statuses by direct SQL. |
| duplicate outbox identity | **IMPOSSIBLE.** Primary key; proven under concurrency. |
| claim without S1H state evaluation | **NONE.** One classifier call site; exported surface asserted against a hand-authored list. |
| fake `DISPATCHED` | **NONE.** Asserted over `src/`, over both schemas, and over every TEXT column of every control table. |
| economic reservation duplication | **NONE.** Before/after snapshots are `toEqual` across enqueue, duplicate enqueue, refused enqueue and claim. |
| control-artifact signing claims | **NONE MADE.** Class 20's obligation is extended and disclosed; classes 3, 20 and 27 remain owed; runtime `I19` and O4 remain OPEN. |

---

## 11. Files added and changed

**Added — production (7):**
`src/db/migrations/0010__dispatch_outbox.sql`,
`src/audit/db/migrations/A0005__outbox_claim.sql`,
`src/kernel/outbox/outboxState.ts`, `correlationTag.ts`, `enqueue.ts`, `claim.ts`,
`recovery.ts`.

**Changed — production (4):** `src/kernel/canonicalisation/canonicaliser.ts` (one export,
one refactor of the field order into a single function),
`src/audit/transport/journalRecord.ts` (one row kind, six fields),
`src/replication/journalPusher.ts` (six columns on the wire),
`src/audit/ingress.ts` (six bound parameters).

**Added — tests (9 suites + 6 controls + 1 compile fixture + 1 fixture):**
`tests/integration/outbox/` — `outbox-enqueue`, `outbox-claim`, `outbox-claim-eligibility`,
`outbox-immutability`, `outbox-crash-matrix`, `payload-mutation-attack`,
`outbox-journal-rows`, `override-backed-claim-race`, `no-transport-boundary`,
`outbox-type-boundary`. `tests/negative-controls/` — `outbox-controls.test.ts` plus
`unsafe-select-then-update-claim`, `unsafe-stale-eligibility`, `unsafe-reclaimable-outbox`,
`unsafe-reconstructing-claim`, `unsafe-outbox-enqueue`, `unsafe-non-atomic-override-claim`.
`tests/type-negative/outbox-caller-supplied-authority.ts`.
`tests/support/outboxFixture.ts`.

**Changed — tests (5):** `tests/support/jcs1Oracle.ts` (one hand-authored field order),
`tests/support/replicationFixture.ts` (six fields on the transport record),
`tests/canonicalisation/i21-type-boundary.test.ts` (one filename in the fixture list),
`tests/integration/authority/local-authorisation-boundary.test.ts` and
`tests/integration/mirror/no-dispatch-boundary.test.ts` — the two narrowings, both recorded
in `S1I-contract.md §9`.

---

## 12. Verification and the final commit

**`npm run verify` green: 120 files, 1797 tests, 1797 passed, 0 failed, 0 skipped, exit 0,
568.27s.** Baseline was 109 files / 1679 tests. See `S1I-result.md §17` for the per-suite
breakdown and the diff sizes.

**Implementation commit: `dec85eb` — `dec85eba480bc9e63f3e56d1fc1afaa32e5a74b8`.**

It carries the two migrations, the five production modules, the four changed production
files, the eleven test suites, the six vulnerable-control modules, the compile fixture, the
fixture, the five changed accepted test files and the whole S1I document set as written at
implementation time. The commit that follows it records that sha in this section and in
`S1I-result.md §1`, for the reason S1H recorded the same split: a result document cannot
contain the sha of the commit that contains it.
