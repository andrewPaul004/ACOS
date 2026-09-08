# S1I — Result

**DURABLE OUTBOX & EXCLUSIVE DISPATCH CLAIM.**

> **S1I DOES NOT PROVIDE EXTERNAL EXACTLY-ONCE.**
>
> What it proves: **one durable outbox identity**, **one durable claim**, **no blind
> reclaim**.
>
> What remains: what happened after a request leaves a process; vendor idempotency; a vendor
> query; outcome reconciliation; provider delivery evidence; and external exactly-once
> itself. None of it is built, and none of it is claimed.

---

## 1. Baseline

| | |
|---|---|
| Required | `8ce0d41` |
| Actual | `8ce0d4121b46d765afe0d8f0c5d6afae5811386f` |
| Worktree at start | clean |
| Branch | `feature/s1i-durable-outbox-claim` |
| Baseline `npm run verify` | **109 files / 1679 tests / 1679 passed / 0 failed / 0 skipped**, exit 0, 596.52s |

---

## 2. Architecture boundary

| | |
|---|---|
| Outbox sections | `25 §7` (the full specification), `34` ADR-026 items 1–2, `24 §4`'s ERD, `33 §6`, `35 §4` item 3 |
| Claim sections | `25 §7`, ADR-026 item 2, registry `I36`, `30 §5.1` item 3's ordering block |
| Eligibility sections | `30 §5.1` item 4, `30 §5.1a`, `22 §3.1`, `30 §5.6`, `30 §5.7.2` |
| S1I starts | after the ACCEPTED S1F local-authorisation commit and the ACCEPTED S1G audit push |
| S1I stops | at `CLAIMED`. `30 §5.1` item 3's next arrow — "dispatch, per (4)" — is computed and the row is claimed; nothing is dispatched |
| **Actual external HTTP?** | **NO** |

---

## 3. What is CLOSED

| Property | Evidence |
|---|---|
| One outbox row per effect idempotency identity, enforced by the DATABASE | `dispatch_outbox` PK `(company_id, idempotency_key)`; sequential, concurrent, rollback and restart cases |
| The uniqueness survives concurrency | two connections, both pre-reading empty, one row |
| The outbox binds to the committed S1F effect and authorisation | nine-column composite FK to `effect`, two-column FK to `authorisation` |
| The exact authorised payload survives the asynchronous boundary | `payload_canonical_bytes`, byte-compared after a source mutation |
| The payload hash equals the accepted canonical hash, enforced by the DATABASE | `dispatch_outbox_payload_binds_hash` |
| No caller or model supplies the payload, the hash, the tag, the recoverability or the eligibility | derived in SQL; no parameter exists; compile-negative |
| Recoverability stays catalogue-owned | FK member; `IRRECOVERABLE` preserved against a `REVERSIBLE` claim |
| The correlation tag is kernel-minted, globally unique, persisted once and immutable | unique index + state-machine trigger; a duplicate enqueue reuses it |
| Claim-time eligibility uses CURRENT state | six operands read in the claim transaction; stale-eligibility control discriminates |
| The FULL-HALT POSTURE blocks the claim for every class including REVERSIBLE | asserted at `PT30M` to the microsecond, and under the threshold from the other side |
| Two concurrent claimers cannot both succeed | two real backends, injected interleaving; control returns two |
| `CLAIMED` never becomes claimable — restart, timeout, clock passage, same worker, other worker, manual replay, direct SQL | trigger admits no UPDATE to a claimed row at all |
| The claim is committed before it is returned | a second connection observes it on the next statement |
| A crash immediately after the claim does not cause a reclaim | the revived process's normal loop finds nothing |
| Authorisation-committed-before-enqueue is recoverable with no second economic authorisation | `dispatch_outbox_missing` + `recovery.ts`, idempotent |
| Enqueue and claim change no reservation, exposure, window, grant, decision or effect | before/after snapshots `toEqual` |
| The irrecoverable execution unit is NOT consumed | all three irrecoverable ledgers asserted zero after an enqueue and two claims |
| No external request, no adapter, no vendor, no credential exists | 23 patterns over the outbox directory; a hand-authored import allowlist |
| No effect is marked externally dispatched | every TEXT column of every control table scanned; both schemas |
| The claim is journaled, cross-implemented on two planes, and replicates | three implementations judged against a hand-authored fourth |
| The override-backed claim binds the exact authority and consumes its allowance atomically | FK, two CHECKs, and a two-row race for one allowance |

---

## 4. Outbox schema

See `S1I-contract.md §4` for the full table with every field's source, mutability and
authority role. In summary:

* **Identity:** `(company_id, idempotency_key)` is the PRIMARY KEY — `25 §7`'s deterministic
  semantic effect key. `outbox_id` is a surrogate and decides nothing.
* **Binding:** nine columns are members of a composite FK to `effect`, including `status`,
  which is why an `AWAITING_APPROVAL` effect has no enqueue path. Two more are a FK to
  `authorisation (authorisation_id, dispatch_payload_hash)`.
* **Payload:** `payload_canonical_bytes` plus `dispatch_payload_hash`, bound to each other
  by a database CHECK over `encode(sha256(...), 'hex')`.
* **Correlation tag:** globally unique, kernel-minted, immutable.
* **Unmirrored requirement:** `claim_requires_unmirrored_tag`, NOT NULL on a claim, and
  CHECK-coupled to `claim_override_id`.
* **Status:** two values, one transition, no way back.
* **Absent by design:** any eligibility column, `claim_expires_at`, any lease or visibility
  column, any attempt counter, `dispatched_at`.

---

## 5. Authorisation → outbox: atomicity or recovery

**The architecture chooses a POST-COMMIT DERIVATIVE, and it says so three times.**

1. `30 §5.1` item 3 prints the authorising transaction's writes as an exhaustive block —
   authorisation, effect, reservation, state transition, journal row — and **no outbox row
   appears in it**. S1F implements that block statement for statement.
2. `23 §6` B8, in prose: *"One transaction commits the authorisation, the effect row, the
   reservation, the state transition and a gap-free locally chained journal row; **dispatch
   follows the commit**, by recoverability class."*
3. `24 §4`'s ERD: `EFFECT ||--o| OUTBOX_ROW` — **zero or one**. An effect with no outbox row
   is a legal state of the model, which under the atomic reading it could not be.

**THE ACCEPTED S1F TRANSACTION IS NOT TOUCHED BY THIS SLICE.** Its kill-point proof is
unaltered and `local-transaction-atomicity.test.ts` now additionally asserts that
`localAuthorisation.ts` cannot name the outbox or the claim at all.

### Kill-point evidence

| Kill point | Outbox | Claim | Reservation | Recovery behaviour |
|---|---|---|---|---|
| Authorisation committed, death before enqueue | absent | none | held, unchanged | `dispatch_outbox_missing` lists it on **every** restart. Recovery re-derives the payload through the registered constructor, the committed hash accepts it, one row is created, and the economic snapshot is byte-identical. |
| Enqueue before commit | absent | none | held, unchanged | Nothing durable. Still discoverable. The retry is the FIRST enqueue and creates one row. |
| After the enqueue commit, before any claim | `ENQUEUED` | none | held, unchanged | A revived process sees it in the candidate list and claims it once. |
| After the claim `UPDATE`, before its commit | `ENQUEUED` | none | held, unchanged | No journal row either — the claim and its record share one commit point. The row is still claimable exactly once. |
| **After the claim commit, before any hypothetical HTTP** | **`CLAIMED`** | **held** | held, unchanged | **The revived process's normal loop finds NOTHING to reclaim. A manual replay by name is refused. `claim_id`, `claimed_by` and `claimed_at` are byte-for-byte what the dead process left. One journal row.** |
| Restart, repeatedly | `CLAIMED` | held | held, unchanged | Identical answer every time. |

**And the journal sequence is GAP-FREE across a rolled-back claim** — `30 §5.2`'s allocator
is a row rather than a PostgreSQL sequence precisely so a rollback leaves none, and S1I's new
emitter is asserted against that.

---

## 6. Payload persistence

| | |
|---|---|
| Representation | **The exact canonical `ACOS-JCS-1` bytes** of the `dispatch_payload` the canonicaliser emitted, as `BYTEA`. Option A of `§9`. |
| Original accepted hash | `authorisation.dispatch_payload_hash`, committed by S1F |
| Outbox hash | the same value, held there by a FK to `authorisation (authorisation_id, dispatch_payload_hash)` |
| Bound how | `CHECK (dispatch_payload_hash = encode(sha256(payload_canonical_bytes), 'hex'))` — **a database property, not an application convention** |
| Mutation attack (`§10`) | authorise `$9.41` → enqueue → mutate the line to `$1.00` → claim → **the row still holds the `$9.41` bytes**, hashing to the committed hash, and does not contain `1.00` |
| Reconstruct-from-live-state control | `unsafe-reconstructing-claim.ts` reads the live line and produces `$1.00`; its canonicalised bytes differ and its hash differs |
| Result | **DISCRIMINATES.** Production returns the originally authorised payload; the reconstructing implementation returns a different one. |
| Drifted reconstruction at ENQUEUE | refused `PAYLOAD_HASH_DIVERGED`; **no row is created**, and the effect needs a fresh authorisation |

**Why a JSONB column was rejected.** It would have needed an RFC-8785 implementation in SQL
to bind it to the hash. Bytes need only `sha256`, which PostgreSQL has natively — so the
binding is enforceable, and `§42`'s STOP condition is never reached: no production journal
row and no production outbox column carries JSON on either plane.

---

## 7. Duplicate enqueue

| Case | Result |
|---|---|
| Sequential | second call returns `ALREADY_ENQUEUED` **with the first row** — same `outbox_id`, same correlation tag. One row. |
| Concurrent, two connections, both pre-reading empty | exactly one `ENQUEUED`, one `REFUSED`. One row. |
| Two distinct effects | two rows, two tags, two idempotency keys |
| After a rollback | nothing durable; the retry is the first enqueue; one row |
| After a process restart, fresh pool | `ALREADY_ENQUEUED`; one row |
| DB uniqueness | `dispatch_outbox_pkey` on `(company_id, idempotency_key)` — the identity IS the key, so a second row is unrepresentable rather than rejected |
| Negative control | `unsafe-outbox-enqueue.ts` keeps the application lookup and drops the key: **two rows** under the same interleaving |

---

## 8. Claim

| | |
|---|---|
| Transaction | one explicit `BEGIN`/`COMMIT`, `inTransaction` |
| Isolation | `READ COMMITTED` — chosen so the loser reads the new row version and returns a determinate `ALREADY_CLAIMED` rather than a retryable `40001`. `33 §6` scopes serialisable to the exposure ledger; the claim moves no money. |
| Lock primitive | `SELECT … FOR UPDATE` on the outbox row, then a re-read of `status` under that lock, then `UPDATE … AND status = 'ENQUEUED'` |
| Not used | no JS mutex, no process singleton, no in-memory lock, no advisory lock, no `SKIP LOCKED` |
| Persisted state before return | `COMMIT` precedes the promise resolving; a **separate connection** observes `CLAIMED` on the next statement |
| Concurrent claim result | one `CLAIMED`, one `ALREADY_CLAIMED`; one journal row; one `claim_id` |
| Same-worker second claim | `ALREADY_CLAIMED` |
| Different-worker second claim | `ALREADY_CLAIMED`; `claimed_by` unchanged |
| Restart reclaim | **NO.** Not in the candidate list; refused by name. |
| Clock passage +1h / +1d / +30d | **NO.** `claimed_at` unmoved. |
| Direct SQL back to `ENQUEUED` | `OUTBOX_ROW_ALREADY_CLAIMED` |
| Negative controls | `unsafe-select-then-update-claim.ts` → **two claims**; `unsafe-reclaimable-outbox.ts` → **reclaims and re-issues** |

---

## 9. Claim-time eligibility

Every expectation below is the accepted hand-authored oracle's
(`tests/support/mirrorPrecedenceTable.ts`), never the classifier's own output.

| State | REVERSIBLE (`campaign.pause`) | COMPENSABLE discretionary (`refund.create`, $10.00) | IRRECOVERABLE (`fulfilment.reship`) |
|---|---|---|---|
| `NORMAL` | **CLAIMED**, row 5, untagged | SUSPEND, row 4, nothing written | HALT, row 1 |
| `UNCORROBORATED_STALL` | **CLAIMED**, row 5, untagged (`I17f(a)`) | SUSPEND, row 4 | HALT, row 1 |
| `CORROBORATED_DEGRADED` | **CLAIMED**, row 5, **TAGGED** (`36 §6`) | SUSPEND, row 4 | HALT, row 1 |
| FULL-HALT POSTURE (`≥ PT30M`) | **HALT**, row 5, `haltedByFullHaltPosture` | HALT | HALT |
| Valid in-scope override (row 4, COMPENSABLE, `refund.create`) | n/a — row 5 has no override path | **CLAIMED**, row 4, **TAGGED**, `override_id` bound, counters incremented | **HALT** — the grant itself is refused by the database |
| Expired override | n/a | HALT | HALT |
| Out-of-scope override (another class) | n/a | SUSPEND | HALT |

**Row 2, `30 §5.1a`'s strict boundary:** `$20.00` is NOT above the floor and falls to row 4;
`$20.01` IS and HALTS at row 2.

**Row 3 — PARTIAL, and it fails closed.** `S1I-C1`: v1.3.3 declares no binding from an
effect to a `statutory_clock.case_ref`, and row 3's operand is keyed on one.
`clockBearingAtClaim()` takes no arguments and returns `false`, so row 3 is unreachable at
claim time and a COMPENSABLE effect falls to row 4. **No relaxation is obtained that the
architecture has not authorised.**

**`S1I-C6` — the class ADR-026 is titled for cannot be claimed at S1.** `22 §3.1` prints row
1 as Halt in **all three** states including `NORMAL`, and `30 §5.1` item 5 plus `51 §3.6`
make it unreachable by override. So `fulfilment.reship` — and by the same rule `email.send`
when it exists — is never dispatch-eligible under v1.3.3 as issued. Reported as a finding;
not routed around.

---

## 10. Override count race

| | |
|---|---|
| Remaining allowance | 1 (also run as 3 with two already taken) |
| Competing claims | two DISTINCT outbox rows, two distinct effects, two real backends, both holding their own row lock before either touches the override |
| Winners | **exactly one** |
| Loser | refused `OVERRIDE_ALLOWANCE_REFUSED` / `PRE_DISPATCH_SUSPENDED`; its row stays `ENQUEUED` |
| Persisted count | `effects_dispatched = 1`, `monetary_dispatched = 10.00`, `status = EXHAUSTED` — derived by the accepted database trigger |
| Journal | one `OUTBOX_CLAIMED` row; the override's own `ALLOWANCE_TAKEN` row beside it |
| Negative control | `unsafe-non-atomic-override-claim.ts` drops `FOR UPDATE` → **two** allowances against a cap of one |

**`S1I-C3`:** v1.3.3 says the counters increment "in the dispatching transaction" and does
not define which transaction that is in a slice with no dispatcher. S1I identifies it with
the CLAIM transaction, which is the only sound reading — the claim is irreversible, so a
later increment admits N+1 — and it is the reading the ACCEPTED S1H code already states in
its own comments.

---

## 11. `I36`

**Exact invariant wording, from `phase2-v1.3-invariant-registry.md`:**

> | **I36** | No outbox row transitions from `CLAIMED` to a second dispatch, by any path. |
> Control | DB (state machine constraint) | Dispatch refused. A second dispatch is a
> critical incident. | Kill at each of the six points in `44 §5.2` against the **real ESP
> sandbox** and assert exactly one accepted message. | S4 | `46 R13` |

| Leg | Status |
|---|---|
| **Enforcement — "DB (state machine constraint)"** | **CLOSED.** `dispatch_outbox_state_machine` admits `ENQUEUED → CLAIMED` and nothing else; no UPDATE to a `CLAIMED` row of any kind; no DELETE on either status. Attacked with direct SQL, and with a conventional stale-lease reaper as the discriminating control. |
| **Claim exclusivity** | **CLOSED.** Two real backends, targeted interleaving, exactly one claim. The `SELECT`-then-`UPDATE` control returns two. |
| **No reclaim by any path** | **CLOSED** for every path S1I can exercise: recovery, restart, timeout, clock passage, the same worker, another worker, a manual replay, a direct `UPDATE`, a `DELETE`. |
| **Verification — six kill points against a real ESP sandbox, provider-reported accepted count** | **OPEN.** Kill points 1, 2 and 6 of `44 §5.2` are covered (before the claim commits; after the claim and before the request; a recovery re-driving an incomplete step). Points 3, 4 and 5 are defined by a request existing. |
| **The dispatch leg** | **PARTIAL — no real dispatch exists.** |

### The status, stated in the mandate's own terms

> **`I36` — CLAIM EXCLUSIVITY CLOSED; REAL DISPATCH LEG PARTIAL.**

**EXTERNAL EXACTLY-ONCE IS NOT CLOSED AND IS NOT CLAIMED.** `I36`'s registry text is a
property about outbox transitions and S1I closes the transition; the registry's own
verification column requires a provider's accepted count, and there is no provider. The
outbox row count is not a provider accepted count. The claim count is not a provider
accepted count.

---

## 12. Crash matrix

See `§5` above for the table. Six kill points, each with the outbox state, the claim state,
the reservation state and the recovery behaviour, all read from a revived process against
the same database.

---

## 13. Negative controls

Ten required by `§37`; ten present; **all ten discriminate.**

| # | Attack | Vulnerable result | Production result | Discriminates? |
|---|---|---|---|---|
| 1 | application-only duplicate enqueue | 2 rows for one intended effect | 1 row; the second call returns the first | **YES** |
| 2 | claim as `SELECT`-then-`UPDATE` | **2 claims** | 1 `CLAIMED`, 1 `ALREADY_CLAIMED` | **YES** |
| 3 | `CLAIMED` reclaimable after a timeout | reclaims and re-issues a second claim | refused; `claimed_at` unmoved | **YES** |
| 4 | payload reconstructed from live state | `$1.00` — different bytes, different hash | the authorised `$9.41` bytes | **YES** |
| 5 | caller-supplied recoverability | stores `REVERSIBLE` for an IRRECOVERABLE action | stores `IRRECOVERABLE`; the claim then HALTS at row 1; and the FK refuses the row outright | **YES** |
| 6 | eligibility trusted from enqueue time | claims six hours into a full halt | `PRE_DISPATCH_HALTED` | **YES** |
| 7 | full halt ignored at claim | `DISPATCH_ELIGIBLE` | `PRE_DISPATCH_HALTED`, row 5, `haltedByFullHaltPosture` | **YES** |
| 8 | override final count raced non-atomically | **2** against a cap of 1 | exactly 1; `EXHAUSTED` | **YES** |
| 9 | caller changes payload/tag after enqueue | accepts both; the row no longer hashes to its own hash | refuses both, naming the mechanism | **YES** |
| 10 | claim bypass skipping the classifier | claims an IRRECOVERABLE effect with no evaluation at all | refused at row 1, `ownerOverrideAvailable = false` | **YES** |

**`§38`'s rule is honoured literally.** The concurrency control asserts **exactly two**
claims, not "at least one" and not "differs from production" — so a run in which the
interleaving accidentally serialised would FAIL and report that the discrimination had been
lost, rather than passing quietly.

**Every control is TEST-ONLY**, under `tests/negative-controls/`, and
`no-transport-boundary.test.ts` asserts that no file in `src/` imports from `tests/` or names
an `unsafe-` module. Each writes to its own unconstrained table, because `0010`'s triggers
would refuse the unsafe write on the production row and the control would then be
demonstrating the trigger rather than the defective mechanism. Every case asserts the
production row is untouched afterwards.

---

## 14. Economic state

Enqueue and claim alter **nothing**. Asserted as a single `toEqual` over a snapshot of
`exposure_reservation`, `window_balance` (all eleven ledger columns), `standing_window_exposure`,
`authorisation`, `authorisation_decision` and `effect`, taken before and after:

* one enqueue, a duplicate enqueue, a refused enqueue and a rolled-back enqueue;
* one successful claim and one refused claim.

| Quantity | Enqueue | Claim |
|---|---|---|
| `exposure_reservation` rows and amounts | unchanged | unchanged |
| `reserved_monetary`, `standing_monetary`, `presumed_monetary`, `realised_monetary` | unchanged | unchanged |
| `reserved_count`, `standing_count`, `presumed_count`, `realised_count` | unchanged | unchanged |
| `reserved_irrecoverable`, `presumed_irrecoverable`, `realised_irrecoverable` | unchanged, **and asserted ZERO** | unchanged, **and asserted ZERO** |
| `standing_window_exposure` | unchanged | unchanged |
| `authorisation` (exposure, recoverability, gate class) | unchanged | unchanged |
| `authorisation_decision` (verdict) | unchanged | unchanged |
| `effect` (status, recoverability) | unchanged | unchanged |

**`§24` — the irrecoverable execution unit is not consumed.** v1.3.3 places the consumption
at `PRESUMED_EXECUTED` (`35 §4`: *"It is marked `PRESUMED_EXECUTED`, the irrecoverable unit
is consumed"*; ADR-026 item 3 the same), which requires a real request uncertainty, which
requires a request. Asserted as a ZERO rather than only as an equality, so a fixture that had
pre-consumed a unit could not make the case pass.

**`§23` — the unknown-outcome policy is NOT implemented, deliberately.** `§23` permits a
pure deterministic policy function over trusted recoverability. S1I declines: the policy's
output is a TRANSITION (`PRESUMED_EXECUTED`, or hold-and-resolve) that only exists after a
real request uncertainty, and a function whose output nothing may consume would be an unused
authority surface in the one place `§23` also says "Do NOT generate an unknown outcome in
production because no transport exists." **What S1I does instead is store every authoritative
operand the later decision needs:** the catalogue-bound recoverability, the correlation tag
the provider event will match on, the payload hash, the matched precedence row, the mirror
state at the claim, the unmirrored-tag requirement and the override identity — all immutable.

---

## 15. No external dispatch

| | |
|---|---|
| HTTP | **NO** |
| adapter | **NO** |
| vendor SDK | **NO** |
| vendor credential | **NO** |
| `DISPATCHED` effect | **NO** |
| provider outcome | **NO** |
| scheduler / poller / background worker | **NO** |
| lease / visibility timeout / reclaim | **NO** |

Asserted, not asserted-about: 23 transport patterns over `src/kernel/outbox/`; a
hand-authored import allowlist for the same directory; the accepted global absences for
adapters, vendors, anchors and settlement; the outbox modules' exported surface against a
hand-authored list; every TEXT column of every table in the control database scanned for an
external-outcome literal; and the audit store's relations and row kinds.

---

## 16. Accepted regression

| Slice | Status |
|---|---|
| S1A | **GREEN** |
| S1B | **GREEN** |
| S1C | **GREEN** |
| S1D | **GREEN** |
| S1E | **GREEN** |
| S1F | **GREEN** |
| S1G | **GREEN** |
| S1H | **GREEN** |

**No accepted test was deleted. No accepted assertion was weakened.** Five accepted files
were amended, and each amendment is a NARROWING recorded in the file itself and in
`S1I-contract.md §9`:

| File | Amendment |
|---|---|
| `local-authorisation-boundary.test.ts` | `/CLAIMED/` and `/outboxClaim/i` become a CONFINEMENT against a hand-authored file list, plus a new assertion that the money path knows neither. `settled_total` and `vendorQuery` stay global. The accepted file's own comment said the absence held *"until the outbox exists"*. |
| `no-dispatch-boundary.test.ts` | three patterns removed from the mechanism list; `kernel/outbox` added to the mirror-confinement allow list; the control-schema relation check narrowed to a two-relation allowlist with `adapter\|vendor` still global. |
| `local-transaction-atomicity.test.ts` | `/\boutbox\b/i` becomes a confinement against the same file list; **and a new, sharper assertion is added** — `localAuthorisation.ts` can name neither the outbox nor `CLAIMED`, so no outbox write can join the S1F commit point. Every transport pattern stays global. |
| `post-commit-and-crash-matrix.test.ts` | the pusher's `outbox`/`CLAIMED` absences replaced by six sharper ones (`dispatch_outbox`, `claimForExternalDispatch`, `enqueueDispatch`, `'CLAIMED'`, `INSERT INTO`, `DELETE FROM`) plus the retained `FOR UPDATE`/`SKIP LOCKED`, and two positive assertions that the claim columns ARE on the wire. **A latent defect in the accepted file is disclosed rather than silently repaired:** its `CLAIMED` pattern contained two literal `0x08` BACKSPACE bytes where `\b` was intended, so it could never fire. |
| `vc-a3-cross-implementation.test.ts` | six `NULL`s appended to each positional `ROW(...)` cast, for the reason the accepted file's own comment gives: *"A positional ROW cast must match the table's arity [...] They are listed rather than omitted so a future column cannot silently shift a field."* No expectation changed. |
| `i21-type-boundary.test.ts` | one filename added to the type-negative fixture list; the count in the case title updated. |

---

## 17. Verification

| | |
|---|---|
| `npm run verify` | **GREEN**, exit 0 |
| typecheck | green |
| lint | green at `--max-warnings 0` |
| Test files | **120** (baseline 109, **+11**) |
| Tests | **1797** (baseline 1679, **+118**) |
| Passed | **1797** |
| Failed | **0** |
| Skipped | **0** |
| Duration | 568.27s |
| `.only` / `.skip` / `.todo` / hidden filtering | **none** — asserted by grep over `tests/` |
| Focused S1I suites | **11 files / 118 tests, all passing** |
| Real-PostgreSQL S1I tests | **113** — every S1I case except the five in `outbox-type-boundary.test.ts`, which is a real `tsc` run over the shared type-negative project |
| Concurrency tests (targeted interleaving, two real backends) | **6** — concurrent enqueue, concurrent claim, the claim control, the override race ×2, the override control |
| Vulnerable controls | **10**, in **6** TEST-ONLY modules |
| Worktree clean at finish | yes |


### The eleven focused suites, individually

| Suite | Tests |
|---|---|
| `tests/integration/outbox/outbox-claim-eligibility.test.ts` | 23 |
| `tests/integration/outbox/no-transport-boundary.test.ts` | 15 |
| `tests/integration/outbox/outbox-claim.test.ts` | 14 |
| `tests/integration/outbox/outbox-immutability.test.ts` | 14 |
| `tests/integration/outbox/outbox-crash-matrix.test.ts` | 13 |
| `tests/integration/outbox/outbox-enqueue.test.ts` | 12 |
| `tests/integration/outbox/outbox-journal-rows.test.ts` | 7 |
| `tests/negative-controls/outbox-controls.test.ts` | 7 |
| `tests/integration/outbox/outbox-type-boundary.test.ts` | 5 |
| `tests/integration/outbox/override-backed-claim-race.test.ts` | 5 |
| `tests/integration/outbox/payload-mutation-attack.test.ts` | 3 |
| **Total** | **118** |

### Diff size against `8ce0d41`

Production added: 2 migrations (control `0010`, audit `A0005`) and 5 TypeScript modules
under `src/kernel/outbox/`. Production changed: **4 files, +106 / −9 lines** —
`canonicaliser.ts` (one export plus the field-order refactor), `journalRecord.ts` (one row
kind, six fields), `journalPusher.ts` (six columns on the wire), `ingress.ts` (six bound
parameters). Tests changed: 8 files, +324 / −25 lines, of which six are the narrowings and
additions recorded in `§16`.

---

## 18. Remaining obligations

### Directly downstream of this slice

| Item | Status |
|---|---|
| **Real external dispatch** | **OPEN.** No transport of any kind exists. |
| `I36`'s dispatch leg — six kill points against a real ESP sandbox, provider-reported accepted count | **OPEN** |
| **External exactly-once** | **OPEN AND NOT CLAIMED** |
| Provider idempotency headers | **OPEN** |
| Provider query / the effect reconciler's external write | **OPEN** |
| Unknown-outcome runtime transition | **OPEN.** The operands are stored; the transition is not built. |
| `PRESUMED_EXECUTED` from a real uncertain request | **OPEN** |
| Delivery-event reconciliation; `VERIFIED`; `NEVER_SENT` | **OPEN** |
| MIE consumption at `PRESUMED_EXECUTED` | **DEFERRED.** All three irrecoverable ledgers asserted zero. |
| Row 3's claim-time eligibility (`S1I-C1`) | **PARTIAL, fail-closed** |
| **`I20`** — provider accepted ≤ reserved irrecoverable units | **OPEN.** No provider. Outbox row count is not provider accepted count. |
| **`I8`** — the audit plane's inverse vendor sweep | **OPEN.** No vendor credential exists. |
| `I17b` — hourly external anchoring | **OPEN** |
| `I17c`'s scheduler leg | **OPEN** |
| `I17f(a)` and `I17f(c)` — the actual dispatch→tag runtime enforcement | **OPEN.** The requirement is preserved immutably; nothing is tagged, because nothing is dispatched. |
| `I18d` — settlement tolerance | **OPEN** |
| Settlement; reconciliation | **OPEN** |
| `I51`, `I58`, `I60`'s transition leg | **OPEN** |
| Approval resume, verify mode, `R′`, `VC-C4` | **OPEN** |
| Standing-revocation execution | **OPEN** |
| The reaper / `I32` | **OPEN** |
| symcc; real adapters; AI CEO and workers | **OPEN** |

### `VC-C3` — **PARTIAL; the external execute span remains open**

`25 §14` requires the entity advisory lock *"for the duration of the
propose→authorise→execute span"*. S1I extends nothing there: the outbox row is created and
the claim taken on ordinary pool connections, AFTER the S1F lease has been released, because
`30 §5.1` item 3 places both after the commit and after the audit push. There is no execute
step to hold a lease through, and S1I does not invent a way to bridge one.

> **`VC-C3` — PARTIAL; external execute span remains open.**

### Control artifacts — carried forward, and one extended

| Class | Status |
|---|---|
| **Class 20** — journal canonicalisation specification (`ACOS-JCS-1`, column order per row kind) | **SIGNATURE OWED, AND S1I EXTENDS THE OBLIGATION.** A new row kind adds a column order and therefore moves class 20's `content_hash`. Owed since v1.3.2; still owed; now covering one further kind. |
| **Class 3** — the action catalogue, including the approval floor | **FRESH SIGNATURE OWED** (v1.3.3 declared the floor's value) |
| **Class 27** — the two degraded-mode thresholds | **FIRST SIGNATURE OWED** (added by v1.3.3) |
| Runtime `I19` — control-artifact hash verification at load | **NOT IMPLEMENTED** |
| **O4** — Cedar policy-artifact owner signing | **OPEN** |
| Control-artifact key management | **OUT OF SCOPE; NOT BUILT** |

### THE PRE-LIVE-EXECUTION GATE — recorded as `§34` requires

> **No later slice may enable a real external effect until the owner/control-artifact
> signing and integrity sequencing has been re-evaluated against the then-current
> architecture.**
>
> S1I is admissible with classes 3, 20 and 27 unsigned and runtime `I19` absent **only
> because it stops before any vendor call**. The moment transport exists, an unsigned
> control artifact is a live authority defect rather than a scheduled obligation: class 3 is
> the action catalogue that assigns recoverability, class 20 is the specification the audit
> chain's meaning rests on, and class 27 declares the thresholds that decide whether an
> effect may leave at all.

### The `mirror_declaration.opened_at` residual — carried forward unchanged

S1H disclosed that `opened_at`'s immutability rests on the migration/DDL principal boundary
rather than on a row trigger. **S1I neither solved it nor broadened runtime access to it.**
`outbox-immutability.test.ts` asserts that no `UPDATE mirror_declaration` statement anywhere
in `src/` names `opened_at`, and that the outbox directory writes to no mirror table at all.
The accepted `closeMirrorDeclaration`'s `closed_at` write is untouched and is required by
`30 §5.1a`. The DDL-principal threat belongs to the higher-trust / supply-chain / anchoring
work, as `§35` directs.

### Carried from S1G, unchanged

Two PostgreSQL containers on one machine are not `30 §5`'s *"different provider or, at
minimum, a separate account with a separate payment method and separate operator
credentials"*. **OPEN.**

---

## 19. Architecture conflicts and owner clarifications

**Seven items, all in `S1I-owner-clarifications.md`. One is a STOP.**

| Id | Subject | Disposition |
|---|---|---|
| **S1I-C1** | No declared binding from an effect to a `statutory_clock.case_ref`, and row 3's operand is keyed on one | **STOPPED.** Fail-closed; the row-3 claim-time leg is PARTIAL. **Owner decision required.** |
| S1I-C2 | v1.3.3 names `CLAIMED` and declares no pre-claim state | `ENQUEUED` declared; the structure is architecture. Confirmation requested. |
| S1I-C3 | "the dispatching transaction" is undefined in a slice with no dispatcher | the CLAIM transaction — the only reading that preserves the cap. Confirmation requested. |
| S1I-C4 | No declared byte order for a record of the claim | declared in `S1I-contract.md §5`; class-20 signature obligation extended. |
| S1I-C5 | The outbox is scoped to "irrecoverable sends" in four places and presented generally in two | widened uniformly; strictly stronger. Confirmation requested. |
| **S1I-C6** | `22 §3.1` prints row 1 as Halt in `NORMAL` too, so the class ADR-026 is titled for cannot be claimed at S1 | reported as a finding; the printed table implemented. **Owner reading required.** |
| S1I-C7 | `37` schedules the outbox at S4 | owner sequencing decision, recorded. |

---

## 20. Recommended next slice

**S1J — the effect gateway's dispatch composition against a mock adapter, with the
unknown-outcome transition and the recoverability-keyed policy.**

Name only. Not implemented, not designed, and not begun.
