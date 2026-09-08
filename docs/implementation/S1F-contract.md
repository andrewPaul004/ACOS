# S1F — Atomic Local Authorisation Commit: Contract

**Slice.** `26 §7` steps **R through W**, committed as **one PostgreSQL transaction**.

**Accepted baseline.** `5d289ab` — the S1E owner-resolution commit. 66 test files, 901
tests, 901 passing, 0 failed, 0 skipped, `npm run verify` green.

**Branch.** `feature/s1f-atomic-authorisation-commit`.

**Architecture.** `docs/architecture/v1.3.1/` — Operating Spine v1.3, package issue v1.3.1.
Treated as normative and read-only. No file under `docs/architecture/` is modified by this
slice.

---

## 1. The one sentence this slice exists to make true

`33 §1`, the decisive property of the selected architecture (Option A), verbatim:

> **The exposure reservation, the authorisation decision, the effect journal row with its
> gap-free sequence and local chain hash, and the resulting state transition commit or fail
> together, as a single Postgres transaction.**

and, on why it was decisive, verbatim:

> `26 §10`'s authorised-loss quantities are the governing control of the whole system, and
> their validity rests entirely on reservations being uncheatable under concurrency. Option
> B makes that a distributed protocol; Option C makes it a race between a log append and a
> projection. Both put the most likely location of a subtle bug *inside the mechanism that
> bounds financial loss*. A makes it a `BEGIN`.

**S1F is therefore not "insert a reservation".** `33 §6` names the tables that transaction
spans — *"`authorisations`, `effects`, `exposure_reservations` and `state_facts` — four
module schemas"* — and the `effect_path` role that spans them plus `journal`. Every one of
those local records is IN SCOPE for S1F because the architecture requires them to share a
commit point with step R.

---

## 2. Scope

### 2.1 What S1F implements

| `26 §7` step | Behaviour | Where |
|---|---|---|
| **R** — Reserve | Both branches, as restated by `phase2-v1.3.1-errata.md §1` (E1 / TB-03). Ordinary: `total_exposure` into `I3` term 1 against **every** referenced window instance. Rate: a **real zero-amount reservation row**, plus `StandingAuthorization` + `StandingRevocationAuthority` + `standing_window_exposure`, whose `forward_monetary` enters `I3` **term 2**. | the ACCEPTED S1A `exposure/stepR.ts`, called unchanged |
| **S** — approval requirement | `NONE` continues to T. A tier returns `REQUIRE_APPROVAL` with the reservation **held**, and creates the initial `PENDING` `Approval` row in the SAME transaction (`26 §7` property 6, SR5; `25 §12` item 2). | `authorisation/localAuthorisation.ts` |
| **T / U** — mint / verify the idempotency key | The `effect` row's primary key `(company_id, idempotency_key)` IS the check (`33 §6`, registry `I42`). The insert decides; a `SELECT` first would be a check two concurrent transactions can both pass. | `authorisation/localAuthorisation.ts`, migration `0007` |
| **V** — return the prior result | On a unique violation the attempt is released to a savepoint — which takes the reservation, its window rows, the `reserved_monetary` movement and the authorisation row with it — and the prior effect is returned. `26 §7` property 8: *"the reservation is released rather than double-counted."* | `authorisation/localAuthorisation.ts` |
| **W** — PERMIT + signed `AuthorizationDecision` | The decision row, with a real Ed25519 signature over `ACOS-JCS-1`-shaped bytes of every field except the signature (`30 §5.3`). | `authorisation/decisionSignature.ts` |
| the journal row | `30 §5.1` item 1's control-database journal: a company-scoped gap-free `journal_seq` from the `journal_counter` ROW, and a local `prev_hash`/`row_hash` chain over `ACOS-JCS-1` canonical bytes **computed by a control-DB trigger** (`I17d`). | migration `0007` |

Plus:

* the **authorisation row** — `26 §2.1`'s `AuthorizationRequest` as committed state, carrying
  the frozen exposure block, the `dispatch_payload_hash`, the `constructor_version` and the
  `policy_version`, so `I18b` is checkable between two persisted rows;
* the **`authorisation_window_instance`** rows — every referenced instance the AUTHORITY
  named, independently of the reservation's own bookkeeping;
* the **local status transition** — the effect row at `status = AUTHORISED`, which is what
  `30 §5.1`'s ordering block names (§4 below records why that is the state transition S1F
  can commit);
* `26 §7`'s **coarse worker-facing projection**, extended over step R and later.

### 2.2 What S1F refuses to implement

| Excluded | Why | Where it belongs |
|---|---|---|
| `26 §7` step **X** — the audit write | `30 §5.1`: *"Cross-database atomicity is not attempted, because it does not exist."* Its own ordering block puts the push AFTER `COMMIT`. | S1 audit-plane work |
| the audit store, push, `JournalAttestation`, mirror machine, completeness diff, anchor | same | S1 / S6 |
| `VC-A3` — cross-instance `ACOS-JCS-1` byte identity | requires a SECOND independent implementation (the audit trigger). S1F builds the control trigger only. | later explicit validation slice |
| the **outbox** and its exclusive claim (`I36`) | `25 §7` layer 4 | S3+ |
| dispatch, adapters, HTTP, vendor idempotency, vendor query | there is no external write perimeter in S1F | S3 |
| reconciliation, settlement, `I18d` | `25 §8`, registry `I18d` (S3 synthetic, T3 real money) | S3 / T3 |
| approval **RESUME** — step `R′`, verify mode, `CONSTRUCTOR_SEMANTIC_CHANGE`, `RESERVATION_ABSENT`, `EXPOSURE_EXCEEDS_RESERVATION`, `RemedyObligation`, `I58`, `VC-C4` | `26 §12.1`–`§12.3`. S1F creates the initial `PENDING` row and performs no transition out of it. | later slice |
| the `KERNEL_SERVICE` revocation EXECUTION path (`26 §7.1`) | the authority ENTITY is created atomically (`I55`); exercising the pause is a different slice | later slice |
| the reservation reaper, TTL expiry, `I32`'s starvation metric | `26 §12.1`. The TTL is RECORDED; nothing reads it. | S5 |
| a `campaign.budget.set` CONSTRUCTOR | `26 §7` step C2 denies `NOT_CANONICALISABLE` without one, and building one is per-class canonicaliser work | S1 canonicaliser work |
| symcc, Cedar O4 owner signing, `I19`, AI CEO/workers, additional catalogue classes | out of the S1F mandate | later |

---

## 2.3 Where the code lives, and why it is not in `src/kernel/authority/`

The accepted S1E suite asserts that the AUTHORITY TREE performs no money arithmetic and
contains no reservation code — `tests/authority/authority-channel-attacks.test.ts`, *"the
authority tree contains no reservation, dispatch, outbox, audit or adapter code"*, a grep for
`window_balance`, `exposure_reservation`, `FOR UPDATE`, `INSERT INTO` and the rest over
`src/kernel/authority/`.

That assertion is correct and is not weakened. `src/kernel/authority/` is `24 §3` K3 — the
gates — and S1F's transaction is K4 and K5: the Effect Gateway's journal and the Exposure
Ledger's reservation. So the S1F modules live in a NEW module:

```
src/kernel/authorisation/    -- 26 §7 steps R–W: the local authorisation commit
  localAuthorisation.ts        the single transaction
  localAuthorisationErrors.ts  the denial vocabulary and the kill-point declaration
  localAuthorisationResult.ts  the terminal types
  localSteps.ts                the R–W step table
  referencedWindows.ts         every referenced applicable window instance
  decisionSignature.ts         step W's Ed25519 signature over ACOS-JCS-1 bytes
  workerFacingLocalDenial.ts   26 §7's coarse projection, extended past R
```

`authority/preReservation.ts` gains ONE method — `authoriseLocallyUnderLease` — which
composes the accepted gate sequence with the commit. It carries no money-path token, opens no
transaction and takes no lock, so the accepted grep passes unchanged and the composition point
is visible at the boundary between the two modules.

---

## 3. The transaction, exactly

### 3.1 Lock order

`30 §5.2`, declared once (AUD-04), as resolved by S1A owner clarification §1:

1. `window_balance` rows, `FOR UPDATE`, ascending `(window_id, window_instance_key)`
2. `standing_window_exposure` rows, `FOR UPDATE` (rate branch)
3. `journal_counter(company_id)`, `FOR UPDATE` — **LAST**
4. everything else

Taken through the single acquisition site, `exposure/lockOrder.ts`. No module in `src/`
other than that one issues `FOR UPDATE` against a money-path table, asserted by the accepted
`tests/integration/exposure/lock-order.test.ts` source scan.

The counter is acquired in slot 3 and **consumed** at the journal insert. That is what makes
it "last" among LOCKS while every row write stays in slot 4.

`40001` is bounded-retried by the accepted `exposure/retry.ts`. `40P01` is an invariant
defect and propagates unretried; S1F adds no second retry policy and names no deadlock code.

### 3.2 Write order

```
BEGIN ISOLATION LEVEL SERIALIZABLE
  assert current_setting('transaction_isolation') = 'serializable'   -- 33 §6, MAL-08
  derive every referenced window instance from window_registry.period
    and company.timezone; materialise window_balance rows
  1  window_balance FOR UPDATE, ascending
  2  standing_window_exposure FOR UPDATE      (rate branch)
  3  journal_counter FOR UPDATE               -- LAST
  SAVEPOINT s1f_attempt
  4  authorisation + authorisation_window_instance
  5  R   exposure_reservation, reservation_window_instance, window_balance
          (rate: + StandingAuthorization + StandingRevocationAuthority
                 + standing_window_exposure)
  6  S   the approval requirement
  7  T/U effect                     -- (company_id, idempotency_key) IS I42
     V   on 23505: ROLLBACK TO SAVEPOINT s1f_attempt, return the prior result
  8  approval                       -- where step S found a tier
  9  W   authorisation_decision, signed
 10  journal_seq allocation, then effect_journal (chain by trigger)
COMMIT
```

### 3.3 The one place two normative passages order differently

`30 §5.1` item 3 lists the writes as *authorisation row · effect row · reservation row ·
state transition · journal row*. `26 §7` load-bearing property 8 states the R/T ordering and
its purpose, verbatim:

> Idempotency check happens after reservation and before permit (steps T–V), so a duplicate
> proposal returns the prior result **and the reservation is released** rather than
> double-counted.

`30 §5.1` puts the effect row before the reservation row; `26 §7` puts R before T, and its
stated consequence — a *released* reservation — is only reachable if the reservation was
taken before the duplicate was detected.

**This is a difference in write order inside one transaction, not a difference in
mechanism.** Under one commit the intermediate order is unobservable in every respect but
one: which condition determines the outcome when both hold — a duplicate proposal that also
lacks headroom. `26 §7` decides that case explicitly and gives its reason; `30 §5.1`'s list
sits inside a section whose subject is the LOCK order and the single commit point, both of
which S1F honours exactly.

**Resolution: the gate order is `26 §7`'s; the lock order and the commit point are
`30 §5.1`'s and `30 §5.2`'s.** The divergence is confined to the position of one `INSERT`,
and its only observable consequence is asserted rather than left implicit —
`tests/integration/authority/local-idempotency.test.ts`'s *"R PRECEDES T — a duplicate that
ALSO lacks headroom denies WINDOW_EXHAUSTED"*.

This is recorded as an owner-visible reconciliation, not as an amendment: no architecture
file is edited.

---

## 4. Every row mutated inside the single transaction

| Entity / table | Operation | Why it must share the commit point | Same-tx proof |
|---|---|---|---|
| `window_balance` | `UPDATE` (`reserved_*`, and `standing_*` via the sync trigger) | `I3`'s four-term guard is the enforcement; `33 §6` calls the exposure ledger "the only table with a serialisable-isolation requirement" | kill-point matrix; balances read back at `0.00` after every abort |
| `exposure_reservation` | `INSERT` | `33 §1` names it first | kill-point matrix |
| `reservation_window_instance` | `INSERT` per referenced instance | `26 §7` step R reserves against every one | kill-point matrix |
| `standing_authorization` | `INSERT` (rate) | `26 §2.1.3`: *"written in one transaction […] There is no interval in which the standing term is absent and the reservation is zero."* | kill-point matrix, rate branch |
| `standing_revocation_authority` | `INSERT` (rate) | `I55`: *"Created by the kernel atomically with the StandingAuthorization, so one cannot exist without the other."* | kill-point matrix, rate branch |
| `standing_window_exposure` | `INSERT` per referenced instance (rate) | `26 §2.1.3`: the four-term guard "evaluates the four-term sum once, after both" | kill-point matrix, rate branch |
| `authorisation` | `INSERT` | `33 §6`'s first named schema; `I18b` is checked between this row and the reservation row | kill-point matrix |
| `authorisation_window_instance` | `INSERT` per referenced instance | records the instances the AUTHORITY named, independently of the reservation | kill-point matrix |
| `effect` | `INSERT` | `33 §6`: the PK includes the idempotency key "so a duplicate proposal cannot create a second row **even if every layer above it fails**" | kill-point matrix; two raw concurrent inserts |
| `approval` | `INSERT` (`PENDING`, tier only) | `26 §7` property 6: reservation precedes approval, and the window is held across the gap | kill-point matrix, approval branch |
| `authorisation_decision` | `INSERT`, signed | `33 §1` names it second; `I2` is a NOT NULL FK to the reservation | kill-point matrix |
| `journal_counter` | `UPDATE` (`next_seq`) | `30 §5.2`: a ROW, not a sequence, so a rollback leaves no gap | rollback case: `next_seq` back to `1` |
| `effect_journal` | `INSERT` (chain by trigger) | `33 §1` names it third | kill-point matrix; adjacency under concurrency |

**The local state transition.** `30 §5.1`'s ordering block lists *"effect row (status =
AUTHORISED)"* and *"state transition"* as separate lines. S1F commits the first and does not
invent the second: the effect row's `AUTHORISED` status IS the local authoritative
transition available at this boundary, because nothing has been dispatched and no external
state has changed. A commerce-state or work-item transition is a consequence of DISPATCH,
which `30 §5.1` places after `COMMIT`. Recorded as owner clarification **S1F-C2**.

---

## 5. Invariants

| Invariant | Statement (registry) | S1F status | Evidence |
|---|---|---|---|
| **I2** | every PERMIT decision has a `Reservation`; the rate class satisfies it with a real zero-amount row, not an exemption | **CLOSED for the implemented local path** | `authorisation_decision.reservation_id` is NOT NULL with an FK to `exposure_reservation`; no exempt class exists at S1 |
| **I3** | four-term commitment guard per window instance, at serialisable | **integrated** (the guard itself is the ACCEPTED S1A one) | the live S1E→S1F path reaches it: boundary, one-cent-over, realised participation, count ledger, concurrent authorisations |
| **I18a** | `dispatch_payload.monetary_effect == exposure.vendor_amount`, or both null | **unchanged** (S1B); the rate branch's null case is asserted | rate reservation row has `vendor_amount IS NULL` |
| **I18b** | `reservation.amount == exposure.total_exposure`, exactly, no tolerance | **CLOSED at runtime, from committed PostgreSQL rows** | ordinary `10.00 == 10.00 != 9.41`; rate `0.00 == 0.00` |
| **I18c** | `total_exposure >= vendor_amount` where non-null | **unchanged**, and re-asserted on the new `authorisation` row | `authorisation_i18c_total_ge_vendor` |
| **I31** | no second `Reservation` for an authorisation that already holds one | **CLOSED for initial creation** | `UNIQUE (authorisation_id)` on `exposure_reservation`, plus one-decision/one-effect/one-reservation uniqueness |
| **I42** | no two `Effect` rows share an idempotency key; `journal_seq` is not an input to the key | **CLOSED — LOCAL DB half** | `PRIMARY KEY (company_id, idempotency_key)`; sequential, concurrent and raw-insert cases; source scan of `idempotency.ts` |
| **I51** | verify mode never increases a reservation | **schema only, as before** — the `reservation_no_increase` trigger is the ACCEPTED S1A one; the runtime resume path is DEFERRED | trigger presence asserted |
| **I55** | every non-`REVOKED` `StandingAuthorization` has a live `StandingRevocationAuthority` scoped to one class, one resource, one authorisation, zero monetary | **CLOSED for creation**; the revocation EXECUTION path is DEFERRED | both rows committed atomically; scoping asserted field by field |
| **I60** | every approval transition is in the declared set; at most one `RESUMING` | **first clause only** — the unique partial index is installed as the schema prerequisite of the initial row; the transition trigger is DEFERRED with the transitions it constrains | index read from `pg_indexes` |
| **I17d** | hash and sequence values are computed by database functions, not the writer | **CLOSED for the control journal** | the trigger refuses a caller-supplied `prev_hash`/`row_hash` |
| **I17 / I17b / I17c / I17e / I41 / I8** | audit-side completeness, chain verification, inverse sweep | **OPEN** — no audit store exists | — |
| **I18d** | settlement tolerance | **OPEN** — S3 | — |
| **I36** | outbox claim | **OPEN** | — |

---

## 6. Owner clarifications recorded by this slice

1. **S1E baseline is `5d289ab`.**
2. **S1F is not "reservation only."** Where the architecture requires local
   decision/effect/journal state to commit atomically with step R, that state is in scope.
3. **Ordinary reservation amount is `total_exposure`**, never `vendor_amount`.
4. **Rate-class reservation amount is exactly `0.00`.**
5. **`forward_integral` belongs only to the standing term (`I3` term 2).**
6. **The rate-class zero-dollar `Reservation` row is real and mandatory.**
7. **Every matching-grant-referenced window must constrain the effect** — no primary window,
   no first-match, no partial reservation.
8. **Multi-grant authority remains INTERSECTION; window sets remain UNION** (S1E-C4,
   unchanged and not reopened).
9. **The journal counter is acquired LAST** among locks.
10. **`journal_seq` is not part of effect idempotency identity.**
11. **`40001` may be bounded-retried.**
12. **`40P01` is a defect, never a retry.**
13. **No external exactly-once is claimed.** The local DB half of `I42` is closed; the
    outbox, the exclusive claim, vendor idempotency and reconciliation are all OPEN.
14. **No dispatch occurs in S1F.**
15. **VC-C3 remains PARTIAL.**
16. **Approval resume remains deferred.**
17. **Architecture v1.3.1 is not edited.** Zero files under `docs/architecture/` changed.

The slice's own interpretations are in `S1F-owner-clarifications.md`.

---

## 7. Terminal state

```
S1E PRE_RESERVATION_PASS
  -> R  reserve against every referenced instance
  -> S  approval requirement
  -> T/U/V  idempotency
  -> W  PERMIT + signed AuthorizationDecision
  -> journal row, gap-free, locally chained
  -> COMMIT
```

producing exactly one of:

| Terminal | Meaning |
|---|---|
| `LOCAL_AUTHORISATION_COMMITTED` | steps R–W complete; verdict `PERMIT`; effect `AUTHORISED` |
| `LOCAL_AUTHORISATION_PENDING_APPROVAL` | `26 §7`'s `O2` — reservation held, `Approval` at `PENDING` |
| `DUPLICATE_PRIOR_RESULT` | `26 §7` step V — no new effect, no new exposure |
| `LOCAL_AUTHORISATION_DENIED` | `26 §7` `D13` `WINDOW_EXHAUSTED`; the whole transaction rolled back |
| an S1E outcome, verbatim | a pre-R denial or the step-N approval requirement, unchanged |

**None of these is dispatchable.** No variant carries a `DispatchPayload`, an adapter, a
method, a vendor parameter map, a monetary effect, a precondition token or the idempotency
key. `tests/type-negative/local-authorisation-as-dispatchable.ts` asserts that as a compile
failure; the runtime half is in the pipeline suite.

---

## 8. Residuals carried into this slice

* `24 §3.1`'s *"on the database clock"* is satisfied by the kernel-owned injected `Clock`
  rather than by `SELECT now()`. `phase2-v1.3-implementation-brief.md §3` excludes live
  clocks until S5, and the accepted S1A `windowInstance.ts` states the same rule. The COMPANY
  TIMEZONE and the WINDOW PERIOD are read from the database, so nothing caller- or
  model-supplied decides which instance a commitment lands in. Unchanged from S1A.
* `33 §6`'s append-only mechanism is a GRANT. S1 runs as one role — `33 §6` itself declares
  `effect_path` spans every schema and is "the privileged path" — so a trigger is the
  substitute that actually refuses the write, and it refuses it for the privileged role too.
* The rate branch reaches step R with a KERNEL-SUPPLIED exposure block rather than through
  C′, because `campaign.budget.set` has no registered constructor. Same boundary accepted
  VC-S7 drew.
