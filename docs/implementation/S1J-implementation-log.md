# S1J — Implementation Log

**Baseline `e5b356a`. Branch `feature/s1j-mock-dispatch-outcomes`. Package issue `v1.3.4`.**

---

## 1. Baseline evidence, recorded before any edit

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `e5b356ae4d0d647eb7bad9167df55517a278d773` |
| `git status --porcelain` | empty |
| Architecture consistency gate (`analysis/consistency-v1.3.py`) | **48 PASS / 0 FAIL** |
| `npm run verify` | green — typecheck, lint at `--max-warnings 0`, tests |
| Test files | **125** |
| Tests | **1850 passed, 0 failed, 0 skipped** |
| Duration | 896.80 s |
| PostgreSQL | 16.9, two instances (control, audit) |
| Branch created | `feature/s1j-mock-dispatch-outcomes` at `e5b356a` |

---

## 2. The architecture read, and what it decided

The v1.3.4 artifacts read before any design, and what each settled.

| Artifact | What it settled |
|---|---|
| `25 §5` | the work-item lifecycle; the two adapter edges (`adapter returned`, `timeout / ambiguous`); `VERIFYING`'s note that a 200 is not evidence |
| `25 §7` (OBX-01, OBX-02, OBX-03) | the two-state machine with no timeout/lease/expiry/reclaim; the external-write scope predicate; the claim transaction as the dispatching transaction; the EM6 capability criterion |
| `25 §8.3` | the effect reconciler and `OUTCOME_UNKNOWN`'s operational role — **a later slice** |
| `25 §10` | **THE SPECIFICATION** for the recoverability-keyed unknown-outcome policy |
| `25 §14` | the entity lease's propose→authorise→**execute** span — the `S1J-C6` conflict |
| `24 §3` K4 | the gateway's chokepoint role; the terminal status set; the adapter-failure response; "consumes the irrecoverable unit" |
| `24 §3` K5 | the authoritative `window_balance` schema; three irrecoverable terms; no transitions |
| `26 §5` | catalogue-assigned recoverability and execution metadata, "never by a model" |
| `26 §7` | the evaluation sequence, step R's two readings of what is reserved |
| `30 §5.1`, `§5.1b` | the ordered dispatch precedence; IRRECOVERABLE eligible in `NORMAL` only (IRN-01) |
| `30 §5.2` | the lock order and the gap-free sequence |
| `30 §5.3`, `§5.3a` | `ACOS-JCS-1`; one declared row-kind order; "a kind in service without one is a defect" |
| `30 §5.7.2` item 5, `36 §6` | the `DISPATCHED_UNMIRRORED` requirement |
| `33 §6` | serialisable scoped to the exposure ledger; corrections are new rows |
| `34` ADR-026 | the four decision items, and item 763's assignment of items 3–5 to the later slice |
| `35 §4` | `DISPATCHED_OUTCOME_UNKNOWN`; the reservation "remains held" and why |
| `35 §12.3` | the duplicate-send walkthrough; the correlation tag as the resolution key; VAL-04's real-ESP requirement |
| `36 §7` | adapter contract tests, all against a vendor sandbox — **a later slice** |
| `37 §2` + SEQ-01 | the S1/later split, and the six bullets the later slice owns |
| `48` | the external-write perimeter; "the only capable path is an architecture" |
| `49 §3.1` | adapters are TCB members |
| `50 §2` | class 20's signed content, and the owed signatures |
| `51 §2`, `§2.2` | the MIE windows carrying BOTH a count ceiling and an irrecoverable-units ceiling at the same figures |
| registry | `I3`, `I9`, `I20`, `I30`, `I32`, `I36`, `I17f`, `I64`, `I65`, `I66` |
| DUP-01/02/03 remediation | read for INTENT only; v1.3.4 wins wherever it differs |

**The two tripwires the mandate required to be answered before implementing.**

### `§2` — the MIE tripwire

| Question | Answer from v1.3.4 |
|---|---|
| 1. What entity represents the reserved irrecoverable unit? | `window_balance.reserved_irrecoverable` is the only candidate column. **No artifact names it as the MIE reservation**, and `51 §2` gives the MIE windows a `max_count` at the same figure. |
| 2. At what lifecycle step is it reserved? | **UNDECIDED.** `26 §7` step R's prose reserves into `I3` term 1; its flowchart node reserves "money · irrecoverable-count". |
| 3. What mutation is "consume the MIE unit"? | **UNDECLARED.** Four candidates; the artifacts contradict each other. |
| 4. reserved→realised, released+realised, or another movement? | **UNDECLARED.** |
| 5. Which window instances? | Undecided, because (1) is undecided. |
| 6. What lock order? | `30 §5.2`'s exists, but is not engaged by any declared S1J branch. |
| 7. Atomic with the outcome state and journal? | Required by `§20`; unimplementable without (3). |
| 8. What prevents double consumption? | Would be `effect_dispatch_outcome`'s primary key — if a movement existed. |
| **And the deciding fact** | **`stepR.reserveOrdinary` moves `reserved_monetary` and `reserved_count`. `reserved_irrecoverable` has NO production writer in any accepted slice. THERE IS NO RESERVED UNIT TO CONSUME.** |

→ **RETURNED PARTIAL. `S1J-C1`.** Unaffected paths implemented; no counter invented; the
refusal made structural in the schema.

### `§3` — the VC-C3 tripwire

`36 §2.3`'s VC-C3 in v1.3.4 is **content-addressed selector non-substitution**, and it is
CLOSED by accepted work. The clause at issue is `25 §14`'s propose→authorise→**execute**
span, which the accepted session-scoped lease cannot hold across OBX-03's asynchronous
boundary.

→ **CONFLICT REPORTED. `S1J-C6`.** No lease is acquired in the dispatch path, no session is
held open, and no claim is made that a new lease is the old one.

---

## 3. Design decisions, and what each was chosen against

### 3.1 The outcome lives in its own table

**Rejected: a column on `dispatch_outbox`.** `25 §7` OBX-01 admits "no transition out of
`CLAIMED`", and `0010`'s trigger refuses every UPDATE to a claimed row. A column would need
either a weakened trigger or a second transition, and both are `I36`.

**Consequence, and it is a gain:** `§26`'s "every outcome branch remains non-reclaimable" is
true by construction. Nothing in the outcome transaction touches `dispatch_outbox`, so the
claim API's `ALREADY_CLAIMED` refusal cannot be affected by any outcome.

**Rejected: a column on `effect`.** Append-only, with a two-value status CHECK and no UPDATE
path for any role. Recorded as `S1J-C3` and declared: the outcome row carries the
post-dispatch status.

### 3.2 The fresh-claim capability is an opaque object with no own data

**Rejected: a signed token.** A token that can be verified can be verified by anyone holding
the key, which makes it reconstructable — and `§5` requires "not reconstructable by loading
a `CLAIMED` row". A token would also be serialisable, and therefore loggable, queueable and
recoverable after a restart, which is the exact property that must not hold.

**Rejected: a `claim_id` from the row.** That IS the persisted `CLAIMED` row, one field at a
time.

**Chosen:** a frozen object with no enumerable properties, keyed into a module-private `Map`.
Forgery fails because a fabricated object is not a `Map` key; serialisation fails because
`toJSON` throws; reconstruction fails because no exported function accepts a persisted value
and returns one; restart-survival fails because the `Map` is process memory.

**AND THE MINT CANNOT VERIFY ITS OWN PRECONDITION.** `mintFreshDispatchCapability` takes an
identity and no database connection, and performs no read — deliberately. A version that
re-read the row to "confirm" the claim would be exactly the mechanism `§5` forbids: a
function that turns a persisted `CLAIMED` row into a dispatch permission. **The freshness
comes from WHERE it is called**, which is why the single-production-call-site assertion is a
test and not a comment.

### 3.3 The capability does not outlive one gateway call, on any path

Added after a first pass left it live when a kill point threw between the mint and the
invocation. Everything after the mint runs inside a `try` whose `finally` revokes, so a
refused resolution, a hook that throws, an adapter that throws or a failed outcome
transaction all leave `liveCapabilityCount() === 0` — asserted at every kill point.

### 3.4 The attestation is deliberately NOT single-use

A local outcome transaction can legitimately be retried — a `40001`, a connection loss
before `COMMIT` — and the SAME invocation's outcome must be presentable again, because
re-invoking the adapter to obtain a fresh attestation is precisely the duplicate `I36`
forbids. `§25`'s exactly-once property comes from the outbox row lock and
`effect_dispatch_outcome`'s primary key, not from consuming a token.

### 3.5 The claim is imported, not wrapped

`src/kernel/outbox/` is **byte-identical to `e5b356a`.** The gateway calls
`claimForExternalDispatch` and mints the capability on the next line. This was chosen over
having the claim itself mint the capability, for two reasons: the accepted slice stays
untouched, and the accepted `no-transport-boundary.test.ts`'s hand-authored import allowlist
for `src/kernel/outbox/` does not have to move.

### 3.6 `economic_movement` is a column pinned to `NONE`

**Rejected: no column at all.** "Nothing moved" would then be an absence a reader has to
infer, and a later slice could add a movement without changing anything a reviewer reads.

**Chosen:** a value on the row with a `CHECK (economic_movement = 'NONE')`. A later slice
that moves money on an outcome must change a migration.

### 3.7 The gateway's success arm is `OUTCOME_RESOLVED`, not `DISPATCHED`

A first pass named it `DISPATCHED`, and the ACCEPTED `no-transport-boundary.test.ts` failed
on its own assertion that the literal `'DISPATCHED'` appears nowhere in `src/`. **The test
was right and the name was wrong**: v1.3.4 declares no `DISPATCHED` state, and a result arm
called `DISPATCHED` is exactly the blurring `§41` of the S1I mandate forbids. Renamed, and
the accepted test stayed unamended.

### 3.8 The IRRECOVERABLE refusal is a database CHECK as well as a policy branch

`dispatch_outcome_irrecoverable_unknown_undeclared` makes the row unwritable even by a
direct INSERT. `36 §0`'s single-mechanism rule: a refusal in a service is a refusal one code
path can skip.

---

## 4. What was built, in order

1. `0012__dispatch_outcome.sql` — the outcome table, the journal kind, branch 7, the emitter.
2. `A0007__dispatch_outcome.sql` — the audit plane's independent transcription and the
   widened ingest.
3. `adapterPort.ts` — the contract, with no implementation.
4. `adapterRegistry.ts` — closed resolution and the EM6 predicate.
5. `dispatchCapability.ts` — the capability and the attestation.
6. `dispatchEnvelope.ts` — the frozen envelope over the persisted snapshot.
7. `outcomePolicy.ts` — `25 §10` as a total function.
8. `outcomeTransaction.ts` — the one local transaction.
9. `effectGateway.ts` — the composition.
10. Transport wiring: `journalRecord.ts`, `journalPusher.ts`, `ingress.ts`.
11. Test support: `mockAdapter.ts`, `s1jOutcomeTable.ts`, `gatewayFixture.ts`, and
    `jcs1Oracle.ts`'s fourth reading.
12. Thirteen vulnerable controls across five `unsafe-*.ts` modules.
13. Eleven suites and one type-negative fixture.

---

## 5. Problems hit, and how each was resolved

| Problem | Resolution |
|---|---|
| The accepted VC-A3 cross-implementation test failed with `42846: Input has too few columns` | `0012`/`A0007` add three columns and the test's positional `ROW(...)::effect_journal` cast must match the table's arity. Three `NULL`s appended to each literal, with the same comment every predecessor slice wrote. **No assertion changed.** |
| The accepted `no-transport-boundary.test.ts` failed on `/'DISPATCHED'/` | The gateway result arm was renamed `OUTCOME_RESOLVED`. See `§3.7`. **The accepted test was not amended.** |
| The accepted `local-authorisation-boundary.test.ts` failed on `/'CONSUMED'/` | The capability result arm was first named `CONSUMED`, and `26 §12.2`'s `Approval` state machine has a `CONSUMED` state whose absence is how the DEFERRED approval resume is held. **The accepted test was right and the name was wrong**: an unrelated mechanism was made to look like the resume path arriving. Renamed `CAPABILITY_CONSUMED`; **the accepted test was not amended.** |
| Three accepted boundary suites failed on hand-authored allowlists — `no-dispatch-boundary.test.ts` (3 cases), `local-authorisation-boundary.test.ts` (2), `local-transaction-atomicity.test.ts` (1) | Each asserted the ABSENCE of the mechanism S1J is chartered to build: the `.dispatch(` call, the `outbox`/`CLAIMED` vocabulary reaching a new directory, the `effect_dispatch_outcome` relation, and the three `dispatch_*` journal columns in both planes. Converted to CONFINEMENT against hand-authored lists — the move S1H made when it built the mirror S1G asserted absent, and S1I made for the outbox. `36 §7`'s "reachable **only** through the Effect Gateway" is the property that replaces the withdrawn `.dispatch(` absence, and it is asserted in the same case. **Every unrelated absence in all three files stays global and unchanged**, and `S1J-test-matrix.md §6` records each change with the property that replaced it. |
| The `§25` race test deadlocked | The first shape started the racer inside `afterAdapterReturned` and parked it holding the outbox row lock, so the gateway's own transaction blocked on it forever. Restructured: the conductor lets the racer take the lock, commit, and finish BEFORE the gateway's transaction starts, so production is the SECOND processing — which is the ordering worth constructing, because it is where a second row would appear if one ever could. |
| A hung run left `idle in transaction` backends, and the next run's `beforeAll` timed out | Terminated the leftover backends. A test-harness artefact of the previous deadlock, not a product defect; the restructured race leaves nothing parked. |
| `JSON.stringify` on a `GatewayResult` threw on `bigint` | The result carries `journalSeq` values as `bigint`, deliberately — `30 §5.2`'s sequence must not pass through a JavaScript `number`. The test serialises with a replacer, the same discipline `src/audit/ingress.ts` applies on the wire. |
| A global `\bfetch\s*\(/` source pattern matched `26 §7` step G's precondition port | The port declares an interface METHOD named `fetch` — "the engine fetches; the proposer does not supply" — which is a control-database read. The global pattern was narrowed to `globalThis.fetch`, exactly as the ACCEPTED S1I test scopes the bare pattern to the outbox directory. **The gateway-scoped assertion keeps the bare pattern.** |
| The audit arrival-chain hash did not equal `sha256(bytes)` | `A0001`'s formula is `sha256(framed(audit_prev_hash) ‖ framed(bytes))` — a DIFFERENT chain from the control plane's, which is `I17d`'s point. The assertion was rewritten to re-compute that formula by hand from the oracle's framing primitive, which is a stronger check than the one it replaced. |
| An exhaustive `switch` narrowed both operands to `never`, and the template literal failed lint | `String(...)` on both, with a comment recording that the `never` narrowing IS the exhaustiveness proof. |

---

## 6. What was deliberately NOT built

| Not built | Why |
|---|---|
| Any real adapter | `§7`. `src/` contains no `ExternalEffectAdapter` implementation, and production's registry is empty. |
| The IRRECOVERABLE MIE movement | `S1J-C1`. `§2`/`§16`: do not invent a counter. |
| A known-failure state | `S1J-C2`. `§19`: do not invent one, and do not misuse `NEVER_SENT`. |
| An entity lease in the dispatch path | `S1J-C6`. `§3`: do not pretend a new lease is the same lease. |
| A per-entity dispatch serialisation | `§3` forbids inventing a concurrency rule. Named as a disposition option in `S1J-C6`. |
| A retry loop, a reclaim, a lease, a timeout, an expiry | `25 §7` OBX-01. |
| A scheduler, poller or startup sweep | `§23`. Unbuildable: the capability cannot be obtained from a row. |
| Provider query, delivery webhook, `VERIFIED`/`NEVER_SENT` from evidence, `I8` | `§31`. |
| Any control-artifact signature | `§35`. Classes 3, 20 and 27 remain owed; class 20's obligation GREW. |
| Owner signing / `I19` remediation | `§51`. |

---

## 7. Verification

| | |
|---|---|
| Architecture consistency gate | **48 PASS / 0 FAIL**, re-run after every edit |
| `npm run verify` | **GREEN** |
| Test files | **136** (125 accepted + 11 new) |
| Tests | **1965 passed, 0 failed, 0 skipped** (1850 accepted + 115 new) |
| Duration | 962.03 s |
| `docs/architecture/` | **unmodified** |
| `src/kernel/outbox/` | **byte-identical to `e5b356a`** |

`S1J-result.md §19` carries the diff audit.

---

# The v1.3.5 continuation

**Baseline `81c2939`. Architecture unmodified.** The record below covers what was built
against the accepted v1.3.5 package, and — more usefully — the three places where the
implementation had to stop and decide rather than transcribe.

## A. The three decisions that were not transcriptions

### A1. Only `refund.create` can be revalidated, and the fixture had to supply the rest

`25 §14.1` makes dispatch revalidation mandatory and names the enumeration/option identity as
an operand. `SelectedAuthoritativeOption` is a **union of one** at S1B, and S1B registered a
constructor for exactly one class, so in a conformant S1 pipeline only `refund.create` can be
canonicalised, authorised, or therefore dispatched.

The accepted S1I/S1J fixtures reach `campaign.pause` and `fulfilment.reship` through
hand-authored facts that bypass C′ — **which stood in for only half of it**: they supplied a
canonical payload and no enumeration. Under v1.3.5 those effects are correctly refused at the
dispatch boundary.

**This is a fixture gap, not an architecture contradiction, and it is not reported as one.**
`tests/support/fixtureEnumerator.ts` supplies the missing half, TEST-ONLY, so those classes
revalidate through the production enumeration core exactly as a refund does. Production's
catalogue is untouched and every other harness still registers one constructor, so `36 §2`'s
`NOT_CANONICALISABLE` assertions are unamended. Recorded as `S1J-C10`.

### A2. There were no committed-reservation-release semantics to use

`25 §7.2` releases "under the existing reservation-release semantics". **There were none.**
`26 §7` property 8's release is implemented by rolling back to a `SAVEPOINT`, which releases
by never having committed; S1J is the first slice that releases a committed reservation.

What was built is the minimum that keeps `I3` term 1 reconstructable: the same two terms step
R moved, by the same amounts, on the same bound instances, plus a one-way stamp. Recorded as
`S1J-C8`.

### A3. Two kill points `§13` asks for do not exist

`§13` lists "after decrement reserved" and "after increment presumed" as separate points.
`applyIrrecoverablePresumption` moves both terms in **one `UPDATE`**, so there is no instant
between them — which is `25 §10.1`'s own requirement ("no transaction may expose transient
headroom"), not an omission.

The suite asserts the absence **over the source** rather than reporting an unreachable kill
point, and `unsafeTwoTransactionMovement` shows what the split version costs by observing the
transient headroom from another session.

## B. Two production names changed because an accepted assertion was right

| Accepted assertion | What it caught | Fix |
|---|---|---|
| `local-transaction-atomicity.test.ts`: no bare `COMMIT` outside `pool.ts` | an error message in `dispatchLease.ts` used the word as prose | lowercased; **the accepted sweep was not weakened** |
| `local-transaction-atomicity.test.ts`: the gateway may not import `stepR.ts` | it does not, and must not — a gateway that could call `reserveOrdinary` could mint authority at the dispatch boundary | `ledger.ts` was admitted (it MOVES a declared commitment) and `stepR.ts` stays forbidden (it would CREATE one) |

## C. Isolation, and why it is not uniform

`SERIALIZABLE` where the outcome moves a ledger term, `READ COMMITTED` where it does not.
`25 §10.1` requires the first; the accepted S1J gave the reason for the second, and it still
holds: at a stricter level the loser of a duplicate-outcome race raises `40001` instead of
reading the committed prior outcome, converting a determinate answer into a retryable error.
A branch that moves nothing has no write skew to prevent. Recorded as `S1J-C11`.

## D. The lock order is still the single accepted one

`30 §5.1` (v1.3.5) puts balance locks inside the outcome transaction. They are acquired
through `acquireMoneyPathLocks` — the one acquisition site in `src/` — with
`includeStandingRows: false` (no standing term moves on any outcome) and
`includeJournalCounter: false` (the counter is taken LAST, inside `emit_dispatch_outcome`,
beside the row it numbers). The outcome transaction issues no `FOR UPDATE` of its own, and
`lock-order.test.ts` would fail if it did.

No inversion is constructible: the S1I claim never takes `window_balance`, and the S1F
authorising transaction never takes `dispatch_outbox`.
