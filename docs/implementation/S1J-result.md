# S1J — Result

**VERDICT: PARTIAL.**

**Baseline `e5b356a`. Branch `feature/s1j-mock-dispatch-outcomes`. Package issue `v1.3.4`.**

**MOCK TRANSPORT ONLY. NO REAL ADAPTER, NO NETWORK, NO VENDOR CREDENTIAL, NO PROVIDER
OUTCOME, NO EXTERNAL EXACTLY-ONCE.**

---

## 0. Why PARTIAL, in one paragraph

Every path S1J was chartered to build is built and green **except two**, and both are
PARTIAL because v1.3.4 does not define a load-bearing point rather than because the
implementation could not reach it.

1. **`S1J-C1` — the IRRECOVERABLE unknown-outcome branch.** `25 §10`, `24 §3` K4, `34`
   ADR-026 item 3 and `35 §12.3` all require `PRESUMED_EXECUTED` **and** "consume the
   irrecoverable unit" as one inseparable act. **What the consumption IS as a ledger
   mutation is declared nowhere, the artifacts contradict each other about it, and no
   accepted slice reserves an irrecoverable unit for it to consume.** `§2`/`§16`: RETURN
   PARTIAL, do not invent a counter. Production refuses and writes nothing, and a database
   CHECK makes the row unwritable.
2. **`S1J-C6` — `25 §14`'s propose→authorise→EXECUTE lease span.** The accepted
   session-scoped advisory lease cannot span OBX-03's asynchronous claim boundary, and `§3`
   forbids the three evasions. **Reported as a conflict, not redefined.** (VC-C3's own
   declared clause — content-addressed selector non-substitution — stays CLOSED; it is a
   different property, and this result keeps them separate.)

A third, narrower PARTIAL follows from the same discipline: **`S1J-C2`**, the known
adapter-failure branch, where `24 §3` K4 declares a RESPONSE with no state and the response
contradicts `25 §7` OBX-01.

**Neither PARTIAL weakens a safety property.** "Never re-dispatch" holds on every branch,
including both PARTIAL ones, because it is enforced by the committed `CLAIMED` row and not
by the accounting.

---

## 1. Verdict

**PARTIAL.**

Against `§50`'s twenty-seven criteria:

| # | Criterion | Result |
|---|---|---|
| 1 | Starts exactly from `e5b356a` | **PASS** |
| 2 | Uses v1.3.4 | **PASS** |
| 3 | Fresh branch | **PASS** — `feature/s1j-mock-dispatch-outcomes` |
| 4 | No real external network exists | **PASS** |
| 5 | Adapter used in tests is in-process mock only | **PASS** |
| 6 | Effect Gateway is sole dispatch composition path | **PASS** |
| 7 | Only a FRESH successful claim can invoke an adapter | **PASS** |
| 8 | Persisted old `CLAIMED` rows cannot invoke the adapter | **PASS** |
| 9 | Claim COMMIT precedes mock invocation | **PASS** |
| 10 | Exact persisted payload is handed to the adapter | **PASS** |
| 11 | Correlation tag is preserved | **PASS** |
| 12 | Required degraded/unmirrored evidence is preserved | **PASS** (local leg) |
| 13 | Adapter cannot choose recoverability or economic authority | **PASS** |
| 14 | Current adapter eligibility requirements enforced | **PASS** |
| 15 | Recoverability-keyed unknown policy matches architecture | **PASS** where declared |
| 16 | Money unknown preserves reservation and never retries | **PASS** |
| 17 | IRRECOVERABLE unknown follows the normative MIE behaviour **OR the slice returns PARTIAL if unspecified** | **PARTIAL — `S1J-C1`**, which this criterion explicitly admits |
| 18 | Outcome transaction is atomic | **PASS** |
| 19 | No duplicate economic/MIE movement | **PASS** (none occurs at all) |
| 20 | Crash/restart never blindly re-dispatches | **PASS** |
| 21 | Mock six-point matrix green | **PASS** |
| 22 | Mock matrix NOT presented as real `I36` validation | **PASS** — asserted, not merely stated |
| 23 | `I20` remains open | **PASS** |
| 24 | No delivery reconciliation faked | **PASS** |
| 25 | All prior regressions green | **PASS** — 1850/1850 retained |
| 26 | `npm run verify` green | **PASS** |
| 27 | No unresolved architecture conflict hidden | **PASS** — three reported, with owner decisions named |

**`§50`'s FAIL conditions do not hold.** A restart cannot dispatch a stale `CLAIMED` row
(`fresh-claim.test.ts`, `mock-kill-matrix.test.ts`), and a money unknown cannot become
blindly retryable (`outcome-classes.test.ts`).

---

## 2. Baseline

| | |
|---|---|
| **required** | `e5b356a` |
| **actual** | `e5b356ae4d0d647eb7bad9167df55517a278d773` |
| **branch** | `feature/s1j-mock-dispatch-outcomes` |
| **final commit** | `06514b4` — `feat(s1j): the Effect Gateway's mock dispatch composition and the unknown-outcome state machine` |
| **worktree clean at start** | YES |
| **worktree clean at end** | YES |
| baseline gate | 48 PASS / 0 FAIL |
| baseline `npm run verify` | green, 125 files / 1850 tests / 0 failed / 0 skipped |

---

## 3. Architecture Review

| | |
|---|---|
| **package** | `docs/architecture/v1.3.4/` — **UNMODIFIED by this slice** (`git diff e5b356a -- docs/architecture/` is empty) |
| **exact dispatch sections** | `25 §7` (OBX-01/02/03), `30 §5.1` + `§5.1b`, `30 §5.2`, `24 §3` K4, `33 §1`, `36 §7`, `48 §1`/`§4`, `49 §3.1`, `37 §2` + SEQ-01 |
| **exact unknown-outcome sections** | `25 §5` (lifecycle), `25 §10` (the recoverability-keyed table), `35 §4` (`DISPATCHED_OUTCOME_UNKNOWN` and the held reservation), `35 §12.3` (the duplicate-send walkthrough), `24 §3` K4 (failure behaviour), `25 §8.3` (the reconciler — a later slice) |
| **MIE semantics fully declared?** | **NO.** `S1J-C1`. Four candidate mutations; `I3` term 3 bound to a different state; `I20` reads as though the reserved term survives; the reservation SITE undecided between ledger 2 and ledger 3; and no accepted slice writes `reserved_irrecoverable` at all |
| **orphan `CLAIMED` recovery semantics declared?** | **YES.** `25 §7` OBX-01 gives `CLAIMED` no timeout, lease, expiry or reclaim and says it "is never the subject of a retry that re-claims"; `35 §12.3` says "On recovery, ACOS does not know whether the message was accepted"; `I9` is the detector. **The declared answer is: remain `CLAIMED`, awaiting reconciliation.** No transition by elapsed time, and no transition by recoverability |
| **VC-C3 async semantics** | **The declared VC-C3 (`36 §2.3`) is content-addressed selector non-substitution and stays CLOSED.** The clause at issue is `25 §14`'s propose→authorise→**execute** span, which is **OPEN and in conflict with OBX-03** — `S1J-C6` |
| **conflicts** | **THREE, all reported and none resolved by this slice:** `S1J-C1` (incompleteness), `S1J-C2` (K4's retry vs OBX-01), `S1J-C6` (`25 §14` vs OBX-03) |

**Three further points were declarations rather than conflicts** — `S1J-C3` (post-dispatch
status on an append-only ledger), `S1J-C4` (the identifier for the awaiting-verification
state), `S1J-C5` (the `ACOS-JCS-1` field order for a second row kind) — and each follows the
`S1I-C2`/`S1I-C4` precedent: the STRUCTURE is architecture, only the identifier or the
mechanism is not.

---

## 4. Dispatch Composition

| | |
|---|---|
| **sole entrypoint** | `dispatchAuthorisedEffect(control, registry, {companyId, idempotencyKey, dispatchedBy, now})` in `src/kernel/gateway/effectGateway.ts`. Four scalars and a registry built at process wiring time |
| **fresh claim mechanism** | An opaque frozen object with no own data, keyed into a module-private `Map`. Minted at exactly one production call site — the line after `claimForExternalDispatch` resolves — bound to five identity fields, consumed once, revoked in a `finally` on every other path, `toJSON` throws, and lost on process death |
| **claim COMMIT proof** | STRUCTURAL: `claimForExternalDispatch` opens its own connection, runs `BEGIN`, and `inTransaction` issues `COMMIT` before the promise resolves. The `await` IS the barrier. Instrumented: the gateway emits `CLAIM_COMMITTED` and the MOCK pushes `MOCK_ADAPTER_INVOKED` into the same log from inside its own `dispatch`, so the two events come from different sources. The unsafe in-transaction ordering discriminates |
| **adapter resolution** | `resolveAdapterFor(registry, {adapter, recoverability})`, where both operands come from the committed `dispatch_outbox` row — itself key-bound by `0010`'s composite FK to the committed `effect`, itself written from `ACTION_CATALOGUE[action_class]` |
| **model/caller adapter influence** | **NONE, AND UNREPRESENTABLE.** There is no `adapter` or `adapterId` parameter on any production function in the directory; the type-negative fixture proves the field does not exist. `createAdapterRegistry` additionally refuses, at construction, an adapter whose self-declared identity is not the key, an identity the closed catalogue does not name, and two adapters under one identity |

---

## 5. Mock Adapter Boundary

| | |
|---|---|
| **production adapter implementations** | **ZERO.** `no-real-transport-boundary.test.ts` asserts that no file in `src/` declares an `adapterId` field, a `resolutionCapabilities` array or a `dispatch(` method (with `adapterPort.ts`, which is the type declaration, exempted from the last) |
| **production registry** | `EMPTY_ADAPTER_REGISTRY` — empty. A production process that installs no registry cannot invoke anything: every effect refuses `ADAPTER_NOT_REGISTERED` |
| **mock location** | `tests/support/mockAdapter.ts` — TEST-ONLY. No production file imports it, and no production file imports anything from `tests/` |
| **network use** | **NONE.** In-process function calls. No `fetch`, no `http`/`https`, no `net`/`tls`/`dgram`, no axios, no undici, no WebSocket, no socket, no localhost server, no port, no URL |
| **credentials** | **NONE.** No `process.env` read, no secret loader, no vault, no token, no API key, no `Authorization`, no `Bearer`, and no vendor name anywhere in `src/kernel/gateway/` — thirty patterns asserted |
| **capabilities** | Trusted adapter METADATA over `25 §7`'s three EM6 primitives: `IDEMPOTENCY_HEADER`, `DELIVERY_EVENT_WEBHOOK`, `QUERYABLE_MESSAGE_LOG`. The mock's advertisement is a frozen literal supplied by a test. **NOTHING MEASURED IT**, and `36 §7`'s empirical measurement requirement stays OPEN |
| **accepted-count instrumentation** | `mock.callCount` (entries to `dispatch`) and `mock.acceptedCount` (times its own acceptance point was reached). Plus `observed[]`, recording exactly what crossed the port. **NEITHER IS A PROVIDER ACCEPTED COUNT** |

---

## 6. Payload Envelope

| | |
|---|---|
| **payload source** | `dispatch_outbox.payload_canonical_bytes`, read from ONE committed row. `dispatchEnvelope.ts` imports no constructor, no enumeration port, no commerce reader and no canonicaliser — asserted against a hand-authored import allowlist |
| **hash** | `dispatch_outbox.dispatch_payload_hash`, on the envelope. `0010`'s `dispatch_outbox_payload_binds_hash` CHECK plus the FK to `authorisation (authorisation_id, dispatch_payload_hash)` mean the bytes on the row hash to the hash on the row AND that hash is the one the committed authorisation bound |
| **correlation tag** | Minted at ENQUEUE, persisted, and observed unchanged by the adapter. Asserted identical to raw SQL; unchanged after the dispatch; identical when the dispatch happens six hours later; and there is no field for a caller to override |
| **unmirrored tag** | The claim's `claim_requires_unmirrored_tag` crosses the port on the envelope; the outcome row records `unmirrored_tag_sent`; a DB CHECK forces the two equal; and a trigger re-reads the claim to compare |
| **mutation result** | **THE ORIGINAL PERSISTED BYTES.** The order line was moved `$10.00 → $3.00` between enqueue and dispatch, re-running C′ was shown to produce DIFFERENT bytes, and the mock received the original — compared against raw SQL on both sides |
| **reconstructed-live-state control** | `unsafeReconstructedEnvelope` carries the rebuilt bytes and **disagrees with its own hash**, which nothing on a dispatch path checks. Discriminates |
| **immutability** | Seven-field alias attack. Six scalars THREW (`Object.freeze` + ESM strict mode). The payload write succeeded — into a fresh copy the getter made for that call — and the persisted row, the tag, and what a SECOND reader sees are all unchanged. **No mutable alias to the outbox row exists** |

---

## 7. Outcome Taxonomy

**Exact current names.** Sources: `25 §5` (the two adapter edges), `24 §3` K4 (the third),
`35 §4` (the unknown state), `25 §10` (the policy), and `S1J-C4` for the one implementation
declaration.

| Outcome | Architecture state | Economic action | Redispatch allowed? |
|---|---|---|---|
| `ADAPTER_RETURNED` (`25 §5`: "adapter returned") — REVERSIBLE | `DISPATCHED_AWAITING_VERIFICATION` *(`S1J-C4`)* | **NONE** — `25 §5`: a 200 is not evidence; `24 §3` K5's realised term comes from settlement | **NO** |
| `ADAPTER_RETURNED` — COMPENSABLE | `DISPATCHED_AWAITING_VERIFICATION` *(`S1J-C4`)* | **NONE** | **NO** |
| `ADAPTER_RETURNED` — IRRECOVERABLE | `DISPATCHED_AWAITING_VERIFICATION` *(`S1J-C4`)* | **NONE** | **NO** |
| `OUTCOME_UNKNOWN` (`25 §5`: "timeout / ambiguous") — REVERSIBLE | `DISPATCHED_OUTCOME_UNKNOWN` (`35 §4`) | **NONE** — reservation HELD (`35 §4`) | **NO** |
| `OUTCOME_UNKNOWN` — COMPENSABLE | `DISPATCHED_OUTCOME_UNKNOWN` (`35 §4`) | **NONE** — reservation HELD (`35 §4`) | **NO** |
| `OUTCOME_UNKNOWN` — IRRECOVERABLE | **NONE WRITTEN — `S1J-C1`** | none | **NO** |
| `ADAPTER_FAILED` (`24 §3` K4: "adapter failure") — any class | **NONE WRITTEN — `S1J-C2`** | none | **NO** |

**`VERIFIED`, `PRESUMED_EXECUTED`, `NEVER_SENT`, `DISPATCHED`, `EXECUTED` and `SETTLED`
appear nowhere in `src/`.** The ACCEPTED `no-transport-boundary.test.ts` still asserts each
as an absence, byte-identical to `e5b356a`.

---

## 8. REVERSIBLE / COMPENSABLE Unknown

`25 §10` row 1: **"Hold and resolve.** Reservation held; the reconciler queries or re-POSTs
under the original authorisation; **never a blind retry.**"

| | |
|---|---|
| **resulting state** | `DISPATCHED_OUTCOME_UNKNOWN` — `35 §4`'s own literal, transcribed |
| **reservation** | **HELD.** `35 §4`: "The exposure reservation **remains held**. It is not released on timeout, because releasing it would let a retry plus a concurrent proposal collectively exceed the window." The transaction issues NO statement against `exposure_reservation` at all, and the raw-SQL snapshot is identical before and after |
| **window balance** | **IDENTICAL, all eleven terms.** `reserved_monetary`, `standing_monetary`, `presumed_monetary`, `realised_monetary`, `reserved_count`, `standing_count`, `presumed_count`, `realised_count`, `reserved_irrecoverable`, `presumed_irrecoverable`, `realised_irrecoverable`. **In particular `presumed_monetary` did NOT move**: the registry binds `I3`'s term 3 to `PRESUMED_SETTLED`, which is `I32`'s liquidity-override path (`26 §10.3`) and not this one |
| **retry/reclaim** | **REFUSED.** The claim API returns `ALREADY_CLAIMED` directly, at 1, 30, 365 and 3650 days; the gateway refuses at the claim stage and a fresh adapter is never invoked; `0010`'s trigger admits no UPDATE to the row |
| **journal** | One `DISPATCH_OUTCOME` row, in the same transaction as the outcome row, cross-implemented against the hand-authored oracle by both database triggers, replicated over the accepted post-COMMIT push |
| **negative control** | TWO. `unsafePolicyReleasingReservationOnUnknown` returns `reservation: 'RELEASED'`; `unsafePolicyCollapsingUnknownToFailed` returns `FAILED` + released + `redispatchPermitted: true`. Both discriminate against production's held, non-retryable answer |

**And this is deliberately availability-sacrificing, as the architecture says.** `I32` /
`25 §12`: holding across an unknown outcome is "correct for correctness and **exploitable
for availability**: an adversary able to induce vendor timeouts — including the vendor —
exhausts headroom at zero spend". Headroom starvation, the reaper and the `W_*_OVERRIDE`
path are `I32`/`26 §10.3`'s separate later mechanism and are **OPEN**.

---

## 9. IRRECOVERABLE Unknown

## STATUS: PARTIAL. THE ARCHITECTURE IS INCOMPLETE, AND S1J DID NOT COMPLETE IT.

| | |
|---|---|
| **resulting state** | **NONE.** No outcome row, no journal row, no ledger statement |
| **exact MIE source** | **UNDECLARED.** `window_balance.reserved_irrecoverable` is the only candidate column, no artifact names it as the MIE reservation, and `51 §2` gives the MIE windows a `max_count` at the same figure (13 / 43) |
| **exact MIE transition** | **UNDECLARED.** Four candidates; `I3` term 3 bound to `PRESUMED_SETTLED` rather than `PRESUMED_EXECUTED`; `I20`'s test column reads as though the reserved term survives; `26 §7` step R's prose and flowchart disagree about which ledger is reserved |
| **windows** | Undecidable, because the source is |
| **atomicity** | Would be `effect_dispatch_outcome`'s transaction and primary key — if a movement existed |
| **duplicate processing** | Not reachable: no first processing writes anything |
| **redispatch** | **REFUSED, and this half IS closed.** The committed `CLAIMED` row, `0010`'s trigger and the claim API's `ALREADY_CLAIMED` are what hold it, not the accounting |
| **status** | **PARTIAL** |

**The deciding fact, and it is not a nuance.** `src/kernel/exposure/ledger.ts`'s
`applyReservation` — the only writer of a reservation term in the repository — moves
`reserved_monetary` and `reserved_count`. **`reserved_irrecoverable` has no production
writer in any accepted slice**, and the kill-matrix suite asserts it reads `0` for every
window instance after a real IRRECOVERABLE authorisation and dispatch. Under two of the four
candidate readings the consumption would drive a `BIGINT` term negative and trip
`window_balance_irrecoverable_non_negative`. **THERE IS NO RESERVED UNIT TO CONSUME.**

**How the refusal is enforced, in three layers:**

1. `outcomePolicyFor` returns `UNDECLARED` with reason
   `IRRECOVERABLE_UNKNOWN_MIE_TRANSITION_UNDECLARED`, carrying the citations;
2. `processAdapterOutcomeOn` refuses `OUTCOME_POLICY_UNDECLARED` and writes nothing;
3. `0012`'s `dispatch_outcome_irrecoverable_unknown_undeclared` CHECK makes the row
   unwritable even by a direct INSERT — asserted — and `A0007`'s domain CHECKs make the
   audit plane refuse a pushed row asserting it.

**What the PARTIAL costs.** `I9` will fire on the effect, correctly; `PRESUMED_EXECUTED`
does not exist so there is no state for a later delivery-event resolution to resolve FROM;
and `MIE_discretionary` is not decremented for a presumed execution. **None of the three is
a live exposure at S1J, because no send occurs.** All three become live the moment a real
vendor exists, which is why `S1J-C1` is an owner decision before any real-adapter slice.

**The owner decision has three parts**, set out in `S1J-owner-clarifications.md`: which
ledger holds `MIE_discretionary` headroom; what the consumption moves; and whether `I20`'s
right-hand side is the reserved term before or after consumption.

---

## 10. Confirmed Success

| | |
|---|---|
| **mock outcome** | `ADAPTER_RETURNED` — `25 §5`'s own edge label — with two inert opaque references (`provider_reference`, a 64-hex `raw_response_hash`) |
| **resulting local state** | `DISPATCHED_AWAITING_VERIFICATION` (`S1J-C4`). **Deliberately not `VERIFIED`**: `25 §5` says "a 200 from an API is not evidence that the world changed. Verification is an independent read-back", and S1J performs no read-back |
| **economic movement** | **NONE**, and `§18`'s conditional is answered in the negative: `25 §5` puts money verification at "the settlement reconciliation, not the API response", and `24 §3` K5's realised term is fed by settlement events `28 §4` owns. Asserted with a raw-SQL snapshot identical before and after, on the money-bearing class |
| **journal** | One `DISPATCH_OUTCOME` row, atomic with the outcome row, after the `OUTBOX_CLAIMED` row in the gap-free sequence |
| **idempotent duplicate processing** | **TWICE OVER.** A second gateway call never reaches the outcome stage — it refuses `ALREADY_CLAIMED` at the claim and the second adapter is never invoked. Re-presenting the SAME attestation returns the SAME row with `alreadyResolved: true` and identical `journalSeq`. One outcome row, one journal row, one invocation |

**A MOCK SUCCESS PROVES THE LOCAL STATE MACHINE ONLY. It does not prove that a provider
accepted anything.**

---

## 11. Orphan `CLAIMED`

| | |
|---|---|
| **crash after claim before invocation** | Kill point 2. The claim committed in its own transaction and survives; the mock was never entered (`callCount` 0, `acceptedCount` 0); no outcome row; no journal row; `liveCapabilityCount() === 0` |
| **restart behavior** | **THE ROW REMAINS `CLAIMED`, AWAITING RECONCILIATION.** This is v1.3.4's declared answer, not an inference: `25 §7` OBX-01 gives `CLAIMED` no timeout, lease, expiry or reclaim and says it "is never the subject of a retry that re-claims"; `35 §12.3` says "On recovery, ACOS does not know whether the message was accepted"; `I9` — "no effect is in a non-terminal state past its SLA" — is the detector, escalating "with the effect's reconciliation history attached". **No transition by elapsed time and no transition by recoverability**, and `I9`'s scheduled evaluator is not built at S1J |
| **fresh capability reconstructable?** | **NO.** No exported function anywhere takes an outbox row, an `outboxId`, a `claimId` or any other persisted value and returns a capability; a fabricated object, a structural clone and a `JSON.parse` result are all refused; `toJSON` throws so it cannot even be serialised into a log line; and the registry is process memory |
| **resulting persistent state** | `dispatch_outbox.status = 'CLAIMED'` with its claim columns intact, and no `effect_dispatch_outcome` row. **Intentionally ambiguous, and the architecture says so** |
| **redispatch count** | **ZERO.** The production entry point returns `CLAIM_REFUSED: ALREADY_CLAIMED`, and it is the only production dispatch surface. With two orphaned rows in the database and a working adapter in the registry, nothing happens at all — there is no scheduler, poller or sweep in `src/` |
| **discrimination** | `unsafeDispatchClaimed` dispatches the same row (calls 0→1), and `unsafeDispatchAllClaimed` — `§23`'s forbidden startup sweep — dispatches it again (1→2) |

---

## 12. Six Kill Points — Mock Only

| Kill point | Mock calls | Mock accepted count | DB state | Recovery |
|---|---:|---:|---|---|
| 1 — before claim COMMIT | 0 | 0 | `ENQUEUED`, 0 outcome rows, 0 journal rows | `OUTCOME_RESOLVED` — a FIRST claim, and correct: nothing was claimed. Calls end at 1 |
| 2 — after claim COMMIT, before invocation | 0 | 0 | `CLAIMED`, 0 outcome rows, 0 journal rows | `ALREADY_CLAIMED`. Calls stay 0 |
| 3 — after mock ACCEPTED, before outcome known | 1 | 1 | `CLAIMED`, 0 outcome rows, 0 journal rows | `ALREADY_CLAIMED`. Calls stay 1 |
| 4 — after mock RETURNED, before outcome COMMIT | 1 | 1 | `CLAIMED`, 0 outcome rows, 0 journal rows (**both writes rolled back together**) | `ALREADY_CLAIMED`. Calls stay 1 |
| 5 — after outcome COMMIT | 1 | 1 | `CLAIMED`, 1 outcome row, 1 journal row | `ALREADY_CLAIMED`. Calls stay 1 |
| 6 — recovery / re-entry at each of 2–5 | — | — | unchanged; `liveCapabilityCount() === 0` at every point | `ALREADY_CLAIMED`, and a third attempt too. A key that never existed refuses `OUTBOX_ROW_NOT_FOUND`, so the refusal above is a discrimination and not a blanket |

`§20`'s further property: a rolled-back outcome consumes **no journal sequence** — asserted
by dispatching a second effect afterwards and reading a contiguous `1..n`, so a kill point
cannot manufacture `30 §5.2`'s false suppression signal.

> ## THIS DOES NOT CLOSE REAL-PROVIDER `I36` VALIDATION.

`mock.acceptedCount` is this process's count of times its own in-process function reached
its own acceptance point. `I36`'s verification leg requires "the six kill points of `44 §5.2`
against a **real ESP sandbox**, measured by the provider's own accepted count" (`37 §2`,
SEQ-01, and the registry's own two-leg split), and `35 §12.3` says why a mock cannot
substitute: **"a mock with a naive idempotency implementation passes while the vendor would
not."**

---

## 13. `I36` / `I20` / VC-C3

### `I36` — no outbox row transitions from `CLAIMED` to a second dispatch

| Leg | State | Evidence |
|---|---|---|
| **ENFORCEMENT — the state machine** | **CLOSED at S1I, and re-proved from the dispatch side at S1J** | `0010`'s `dispatch_outbox_state_machine`; `ALREADY_CLAIMED` at 1/30/365/3650 days; the second adapter never invoked on any branch; `0012` adds no transition |
| **LOCAL COMPOSITION — claim state and dispatch composition** | **CLOSED** | Only a fresh claim can invoke; the six-point mock matrix; the orphan-`CLAIMED` proof; the forbidden sweep unbuildable; the double-outcome race decided by a row lock with a primary key behind it |
| **VERIFICATION — six kill points against a real ESP sandbox, measured by the provider's accepted count** | **OPEN** | No provider. No sandbox. No credential. `37 §2` assigns it to S4 and it stays there |

### `I20` — `Σ provider-reported accepted messages ≤ Σ reserved irrecoverable units`

**OPEN, and structurally so on BOTH sides.**

- **Left-hand side:** no provider read exists. Asserted — the audit store holds no table
  matching `provider`, `vendor`, `esp`, `delivery` or `accepted`, and neither does the
  control database. `I20` is an AUDIT-plane invariant reconciled "from its own ESP read
  credential", and no such credential is provisioned.
- **Right-hand side:** `reserved_irrecoverable` is `0` for every window instance, asserted
  after a real IRRECOVERABLE authorisation and dispatch. **`S1J-C1` from the other
  direction.**
- **And no test in this repository compares `mock.acceptedCount` to a reserved unit count.**
  `§30`'s prohibition is honoured, and the three absences above are what make the comparison
  unavailable rather than merely unmade.

### VC-C3 — two clauses, and they must not be conflated

| Clause | State |
|---|---|
| **`36 §2.3`'s declared VC-C3: content-addressed selectors never substitute** | **CLOSED** by accepted work (`tests/integration/enumeration/vc-c3-can03-reordering.test.ts`). S1J does not touch it, and its property is unaffected: nothing on the dispatch path resolves a selector, because the payload is a persisted snapshot |
| **`25 §14`'s entity lease over propose→authorise→EXECUTE** | **OPEN, AND IN CONFLICT WITH OBX-03 — `S1J-C6`** |

**What the conflict is.** `25 §14` requires an advisory lock on
`(company_id, entity_type, entity_id)` "for the duration of the propose→authorise→execute
span". The accepted implementation is a SESSION-level advisory lock on a dedicated
connection — and `entityLease.ts` records why it cannot be transaction-scoped. But OBX-03
puts the claim and the dispatch in a different transaction, possibly a different process,
possibly after a restart. **No mechanism hands a live session lock across that gap**, and
`§3` forbids pretending a new lease is the old one, holding a session open to pass a test, or
claiming the property because an outbox row is unique.

**What actually holds the purpose, and the one part it does not.** `25 §14`'s stated purpose
is that a second item "does not proceed on stale state":

| Concern | Mechanism | Held? |
|---|---|---|
| the dispatched request reflecting stale state | the PERSISTED payload snapshot, hash-bound, never rebuilt | **YES — more strongly than a lock** |
| authority decided on stale state | claim-time re-evaluation of every `30 §5.1` item 4 operand against CURRENT state | **YES** |
| two dispatches of one intent | the exclusive non-reclaimable claim | **YES** |
| **two concurrent effects on one entity, one authorised while another is mid-dispatch** | **nothing** | **NO — the residual** |

The outbox's uniqueness is per EFFECT IDENTITY, not per ENTITY. The owner decision and its
three dispositions are in `S1J-owner-clarifications.md` `S1J-C6`.

---

## 14. Unmirrored Tag

| | |
|---|---|
| **required under** | `30 §5.7.2` item 5 ("Every dispatch under it is tagged `DISPATCHED_UNMIRRORED` and carries `override_id`") and `36 §6` (`CORROBORATED_DEGRADED`: "as `NORMAL`, with every dispatch tagged"). Exercised in a real `CORROBORATED_DEGRADED` state, entered through the ACCEPTED S1H path — a control-plane declaration plus a signed audit-plane corroboration signal |
| **mock received** | `requiresUnmirroredTag === true` on the envelope it was handed, recorded in its own observation, and `false` in `NORMAL` — carried in both directions rather than omitted when absent |
| **journal evidence** | THREE artifacts, each answering one of `§38`'s questions: the claim required it (`dispatch_outbox.claim_requires_unmirrored_tag` + the `OUTBOX_CLAIMED` row's field 16); the gateway sent the requirement (`effect_dispatch_outcome.unmirrored_tag_sent`, forced equal by `dispatch_outcome_unmirrored_tag_not_suppressed`); the resulting state is associated with it (the `DISPATCH_OUTCOME` row's field 17, **REQUIRED-PRESENT**, in the AUDIT PLANE's own copy) |
| **suppression** | **UNWRITABLE.** Both shapes of the lie were attempted directly: the CHECK refuses `requires=TRUE, sent=FALSE`, and the trigger refuses `requires=FALSE` against a claim that required it |
| **real provider evidence** | **NONE, AND OPEN** |
| **`I17f` status** | **`(a)` and `(c)`: the LOCAL/MOCK COMPOSITION LEG only.** The tag now reaches the audit plane's own copy on a dispatch outcome, which is one operand `I17f(c)` needs. **What is absent:** the audit-plane evaluator (`I17f`'s enforcement column is **Audit**, on a declared 15-minute interval), a published `MIRROR_INPUT_STALL` interval to compare against at dispatch time, and any provider-side observation. `30 §5.5` item 9 records the residual in the architecture's own words: rows of this class — "and the `DISPATCHED_UNMIRRORED` tags themselves — **have no detector at all, under any mechanism in this architecture**". Asserted: no audit-plane function matching `%i17f%` exists, and no provider-shaped table exists. **`I17f` IS NOT CLOSED** |

---

## 15. Negative Controls

**Fourteen discriminating controls across `§40`'s thirteen numbered items.** Each runs both
paths against the same database state.

| Attack | Vulnerable result | Production result | Discriminates? |
|---|---|---|---|
| 1. dispatch any persisted `CLAIMED` row after restart | `DISPATCHED`; mock calls 0→1 | `CLAIM_REFUSED: ALREADY_CLAIMED`; calls stay 0 | **YES** |
| 1b. the forbidden startup sweep over `CLAIMED` rows | sweeps and re-invokes; calls 1→2 | no scheduler, poller or sweep exists in `src/` | **YES** |
| 2. adapter invoked before claim COMMIT | `MOCK_ADAPTER_INVOKED` precedes `CLAIM_COMMITTED`; a rollback after acceptance leaves the row `ENQUEUED` and re-claimable → **2 accepted requests for one intent** | `CLAIM_COMMITTED` precedes the invocation, structurally | **YES** |
| 3. caller chooses the adapter | the attacker's `mock_commerce` adapter executes, with the real payload and the real tag | `ADAPTER_REFUSED: ADAPTER_NOT_REGISTERED`; attacker never invoked | **YES** |
| 4. payload rebuilt from live state | carries bytes recomputed after `$10.00 → $3.00`, disagreeing with its own hash | the ORIGINAL persisted bytes | **YES** |
| 5. correlation tag dropped | `correlationTag === ''` | the persisted tag | **YES** |
| 6. unmirrored requirement dropped | `requiresUnmirroredTag === false`, `overrideId === null` | the claim's requirement, and the DB refuses the suppressed row | **YES** |
| 7. caller/adapter spoofs recoverability | IRRECOVERABLE→REVERSIBLE takes hold-and-reconcile; money→IRRECOVERABLE consumes an MIE unit | reads `effect.recoverability` in the outcome transaction; no parameter exists | **YES** |
| 8. money unknown releases the reservation | `reservation: 'RELEASED'` | held, and the transaction issues no ledger statement | **YES** |
| 9. unknown becomes retryable `FAILED`/`READY` | `FAILED`, released, `redispatchPermitted: true` | `DISPATCHED_OUTCOME_UNKNOWN`, held, never redispatchable | **YES** |
| 10. MIE consumed / consumed twice | invents `presumed_irrecoverable += 1`, and twice when called twice | refuses `OUTCOME_POLICY_UNDECLARED`; ledger byte-identical; the row unwritable | **YES** |
| 11. crash after acceptance → second invocation | re-invokes for a `CLAIMED` row with no outcome | `ALREADY_CLAIMED`; accepted count stays 1 | **YES** |
| 12. outcome non-atomic with its journal row | `JOURNAL_ONLY`: one chained journal row, zero outcome rows | both roll back together; both counts 0 | **YES** |
| 12b. outcome race without the row lock | both pass the unlocked read; one `INSERTED`, one `REFUSED_BY_KEY` with an aborted transaction | the loser BLOCKS on the row lock and returns a determinate `alreadyResolved` | **YES** |
| 13. EM6 eligibility ignored | dispatches an IRRECOVERABLE effect to an adapter with zero resolution primitives | `ADAPTER_REFUSED: ADAPTER_INELIGIBLE_FOR_IRRECOVERABLE`; never invoked | **YES** |

**Two are unusual and worth the owner's eye.** Item 10 is not a defect — it is the
DEFINITION S1J refused to make, so production's refusal is the discrimination. Item 12b's
two paths reach the same row count; what differs is WHICH MECHANISM refused, which is
`36 §0`'s single-mechanism rule shown working.

**Nothing is counted that does not discriminate.**

---

## 16. Economic State

Direct SQL, on a fresh connection, `toEqual` before and after. Every `window_balance` term
in all three ledgers, every `exposure_reservation` row, every `standing_window_exposure`
row, every `authorisation` row, every `effect` row.

| Outcome class | Reservations | `window_balance` (11 terms) | Standing | Effect rows | Outbox | Outcome row |
|---|---|---|---|---|---|---|
| `ADAPTER_RETURNED`, COMPENSABLE (money) | **identical** | **identical** | identical | identical, all `AUTHORISED` | `CLAIMED`, untouched | 1, `economic_movement = 'NONE'` |
| `ADAPTER_RETURNED`, REVERSIBLE | identical | identical | identical | identical | `CLAIMED` | 1, `NONE` |
| `ADAPTER_RETURNED`, IRRECOVERABLE | identical | identical | identical | identical | `CLAIMED` | 1, `NONE` |
| `OUTCOME_UNKNOWN`, COMPENSABLE (money) | **identical — HELD** | **identical, `presumed_monetary` did NOT move** | identical | identical | `CLAIMED` | 1, `NONE` |
| `OUTCOME_UNKNOWN`, REVERSIBLE | identical | identical | identical | identical | `CLAIMED` | 1, `NONE` |
| `OUTCOME_UNKNOWN`, IRRECOVERABLE | identical | **identical, including all three irrecoverable terms** | identical | identical | `CLAIMED` | **0 — refused** |
| `ADAPTER_FAILED`, any | identical | identical | identical | identical | `CLAIMED` | **0 — refused** |
| every kill point | identical | identical | identical | identical | per `§12`'s table | per `§12`'s table |

**`reserved_irrecoverable` reads `0` for every window instance throughout**, including after
a real IRRECOVERABLE authorisation and dispatch. That is `S1J-C1`'s deciding fact, measured.

**Enqueue and claim are not economically replayed** — the accepted S1I property, re-asserted
across the dispatch — and **outcome processing mutates no unrelated window**, because it
mutates no window at all.

---

## 17. Audit / JCS

| | |
|---|---|
| **new row kinds** | ONE: `acos.journal.dispatch_outcome.v1`, row kind `DISPATCH_OUTCOME`. Twenty fields |
| **normative order** | Declared field by field in `S1J-contract.md §5`. **AN IMPLEMENTATION DECLARATION — `S1J-C5`** — because `30 §5.3a` declares an order for `acos.journal.outbox_claimed.v1` and for no other kind, and says "a row kind in service without a declared order here is a defect of this class". Offered to the owner in exactly the position `S1I-C4` occupied |
| **control implementation** | `0012`'s branch 7 of `effect_journal_canonical_bytes`. Branches 1–6 are byte-identical to their predecessors, so every already-chained row recomputes to the `row_hash` it holds |
| **audit implementation** | `A0007`'s branch 7 of `audit_journal_canonical_bytes`, transcribed from `S1J-contract.md §5` and **not from the control migration**. Branches 1–6 unchanged |
| **oracle** | `tests/support/jcs1Oracle.ts`'s `dispatchOutcomeFields` — the hand-authored FOURTH reading. The file imports nothing from `src/`. **BOTH database triggers are judged against it, never against each other** (`36 §0`) |
| **seeded swap** | Fields 15 and 16 (`dispatch_outcome_kind`, `dispatch_effect_status`) — same type, same framing, adjacent positions, so only the ORDER distinguishes the two byte strings. The swap produces different bytes and the control trigger matches the correct order and not the swapped one |
| **no insertion order** | Positional concatenations in both planes. No map, no row-to-JSON, no reflection over physical columns — which matters because both migrations add columns at the END of the table while placing their fields in the MIDDLE of the order |
| **NULL framing** | Field 18 (`override_id`) is nullable and frames as the reserved `FF FF FF FF` word with no payload (v1.3.2, JCS-01), preserved unchanged |
| **immutability** | Four columns attempted to `NULL` on the chained row: all refused `JOURNAL_ROW_IMMUTABLE`. The outcome row itself is append-only: UPDATE and DELETE both refused |
| **audit push** | The ACCEPTED S1G post-COMMIT path, unchanged. `ACCEPTED` for every pushed row; the outcome row's sequence is after the claim row's; the audit plane's ARRIVAL chain re-computed by hand from `A0001`'s formula `sha256(framed(prev) ‖ framed(bytes))` — a DIFFERENT chain from the control plane's, which is `I17d`'s point — and the retained `transmitted_bytes` equal the oracle's bytes |
| **audit outage** | The local outcome commits and is readable with nothing pushed; the row sits in the accepted `mirrored_at IS NULL` backlog and drains later. **No cross-database transaction** |
| **CLASS 20 SIGNATURE** | **OWED, AND THE OBLIGATION GREW.** Owed since v1.3.2's NULL-framing correction, extended by v1.3.4 for `OUTBOX_CLAIMED`, and **extended again by S1J.** Nothing in this slice claims it is signed. No deployed chain exists, so no re-anchor is triggered |

---

## 18. Accepted Regression

**1850 of 1850 accepted tests retained and green. No accepted test weakened, skipped,
filtered or deleted.**

| Slice | Accepted at | State |
|---|---|---|
| S1A | — | **GREEN** |
| S1B | `17a6fdd` | **GREEN** |
| S1C | `ee9c518` | **GREEN** |
| S1D | `0054e5f` | **GREEN** |
| S1E | `5d289ab` | **GREEN** |
| S1F | `395a13b` | **GREEN** |
| S1G | `e47a437` | **GREEN** |
| S1H | `8ce0d41` | **GREEN** |
| S1I | `e5b356a` | **GREEN**, and `src/kernel/outbox/` is **byte-identical** to it |

**FIVE accepted test files were amended. Two mechanically, three by converting an ABSENCE
into a CONFINEMENT for the exact mechanism this slice is chartered to build — which is the
move S1H made when it built the mirror S1G had asserted absent, and S1I made when it built
the outbox S1F had asserted absent. `S1J-test-matrix.md §6` carries the full record.**

**Mechanical:**

1. `tests/integration/audit/vc-a3-cross-implementation.test.ts` — three `NULL`s appended to
   each of two positional `ROW(...)` composite casts, because `0012`/`A0007` add three
   columns and such a cast must match the table's arity. **S1H appended eleven, S1I six,
   v1.3.4 one; the file's own comments record the pattern.** No assertion, fixture or
   expected value changed.
2. `tests/canonicalisation/i21-type-boundary.test.ts` — one filename added to the
   type-negative directory listing, "sixteen" → "seventeen". **S1D, S1E, S1F and S1I each
   amended the same line.** The positive control still compiles clean, and "no diagnostic on
   an unmarked line" now covers the new fixture.

**Absence → confinement, with the property that replaces each absence stated:**

3. `tests/integration/authority/local-authorisation-boundary.test.ts` — `claimSites` widened
   by the five gateway files that name `CLAIMED` or `outbox`. **The MONEY-PATH clause is
   untouched:** `kernel/authority`, `kernel/policy`, `kernel/exposure` and
   `kernel/canonicalisation` still contain none of `CLAIMED`, `outbox` or
   `claimForExternalDispatch`, which is the property that case exists for.
4. `tests/integration/authority/local-transaction-atomicity.test.ts` — `OUTBOX_FILES` widened
   by four gateway files. **Every transport pattern stays global and unchanged**, and the
   case's final assertion still reads `localAuthorisation.ts` and requires it to contain
   neither `outbox` nor `CLAIMED`.
5. `tests/integration/mirror/no-dispatch-boundary.test.ts` — four changes: the
   `/\.dispatch\s*\(/` absence withdrawn and replaced IN THE SAME CASE by `36 §7`'s
   confinement assertion (exactly one production caller); the control relation allowlist
   widened by `effect_dispatch_outcome`; and the control and audit column allowlists widened
   by the three `dispatch_*` journal columns. **`/from …adapters?\//`, `/callAdapter/i` and
   `/adapterClient/i` stay global**, and the audit plane still holds no table matching
   `outbox|dispatch|adapter|vendor` at all.

**AND TWO PRODUCTION NAMES WERE CHANGED BECAUSE AN ACCEPTED TEST WAS RIGHT.** Neither is a
test amendment; both are accepted assertions doing their job, and both accepted tests
remain unamended:

| Accepted assertion | What it caught | Fix |
|---|---|---|
| `no-transport-boundary.test.ts`: `'DISPATCHED'` appears nowhere in `src/` | the gateway's success arm was first named `DISPATCHED` — exactly the `CLAIMED`/`DISPATCHED` blurring `§41` of the S1I mandate forbids, and v1.3.4 declares no such state | renamed **`OUTCOME_RESOLVED`** |
| `local-authorisation-boundary.test.ts`: `'CONSUMED'` appears nowhere in `src/` (`26 §12`'s resume is deferred) | the capability result arm was first named `CONSUMED`, making an unrelated mechanism look like the approval-resume path arriving | renamed **`CAPABILITY_CONSUMED`** |

**The ACCEPTED `tests/integration/outbox/no-transport-boundary.test.ts` is byte-identical to
`e5b356a`** — including its assertion that `'DISPATCHED'`, `'EXECUTED'`, `'SETTLED'`,
`'PRESUMED_EXECUTED'` and `'NEVER_SENT'` appear nowhere in `src/`.

**`src/kernel/outbox/` is byte-identical to `e5b356a`, and `docs/architecture/` is
unmodified.**

---

## 19. Verification

| | |
|---|---|
| **architecture gate** | **48 PASS / 0 FAIL** (`analysis/consistency-v1.3.py`, re-run after all edits; `docs/architecture/` is unmodified) |
| **`npm run verify`** | **GREEN.** `tsc --noEmit` clean · `eslint . --max-warnings 0` clean · full suite green |
| **files** | **136** (125 accepted + 11 new) |
| **tests** | **1965** (1850 accepted + 115 new) |
| **passed** | **1965** |
| **failed** | **0** |
| **skipped** | **0** |
| **duration** | 962.03 s |
| **focused S1J** | 115 tests across 11 files, plus 14 type-negative diagnostics in one fixture |
| **real PostgreSQL** | YES — 16.9, two instances (control + audit), schema dropped and rebuilt from empty per test file |
| **mock-adapter kill tests** | 7 (`mock-kill-matrix.test.ts`), covering all six declared kill points plus the re-entry summary |
| **concurrency tests** | 3 — the constructed double-outcome interleaving, the unlocked read-then-write control, and the same-attestation re-presentation (`outcome-atomicity.test.ts`) |
| **vulnerable controls** | 14 discriminating controls across `§40`'s 13 numbered items, in 5 `unsafe-*.ts` modules |
| **worktree clean** | YES |
| **no `.only`, no `.skip`, no hidden filtering** | asserted — `grep -rn "\.only\|\.skip\|describe\.todo\|it\.todo"` over the S1J suites returns nothing, and the run reports 0 skipped |

### Diff audit — `git diff e5b356a...HEAD`

| Checked for | Result |
|---|---|
| real network | **NONE.** `axios`, `node-fetch`, `undici`, `globalThis.fetch`, `http`, `https`, `net`, `tls`, `dgram`, `WebSocket` appear only inside `no-real-transport-boundary.test.ts`'s own denylist |
| credentials | **NONE.** No `process.env`, no `Bearer`, no `apiKey`, no secret loader, no vault — same |
| real adapter | **NONE.** `src/` holds no `ExternalEffectAdapter` implementation; production's registry is empty |
| reclaim path | **NONE.** `src/kernel/outbox/` byte-identical; `0012` adds no transition to `dispatch_outbox`; no timeout, lease, expiry or reaper anywhere |
| public `dispatchClaimed` | **NONE in production.** `unsafeDispatchClaimed` exists only under `tests/negative-controls/`, and no production file imports from `tests/` |
| caller adapter selection | **NONE.** No `adapter`/`adapterId` parameter; type-negative proves the absence |
| mutable / reconstructed payload | **NONE.** Snapshot copied out of the row, fresh copy per read, no constructor imported |
| caller recoverability | **NONE.** Read from the committed `effect` row inside the outcome transaction |
| reservation release on money unknown | **NONE.** No statement against `exposure_reservation` or `window_balance` in the outcome transaction |
| repeated MIE consumption | **NONE.** No MIE movement at all — `S1J-C1` |
| provider claims based only on mock | **NONE.** `§29`/`§30` asserted as three structural absences, and no test compares `acceptedCount` to a reserved unit count |
| control-artifact signatures falsely claimed | **NONE.** Classes 3, 20 and 27 declared OWED in four places, and class 20's obligation declared GROWN |
| `docs/architecture/` modified | **NO** — empty diff |
| `src/kernel/outbox/` modified | **NO** — empty diff |

---

## 20. Scope Escape

| | Required | Actual |
|---|---|---|
| real HTTP | NO | **NO** |
| real vendor | NO | **NO** |
| real credentials | NO | **NO** |
| real adapter | NO | **NO** |
| provider query | NO | **NO** |
| webhook | NO | **NO** |
| reconciliation | NO | **NO** |
| external exactly-once claimed | NO | **NO** |

---

## 21. Remaining Obligations

### The three owner decisions S1J is blocked on

| Id | Decision |
|---|---|
| **`S1J-C1`** | Which ledger holds `MIE_discretionary` headroom; what "consume the irrecoverable unit" moves; whether `I20`'s right-hand side is the reserved term before or after consumption. **Blocks the IRRECOVERABLE unknown-outcome branch, and must be settled before any real-adapter slice** |
| **`S1J-C2`** | Whether `24 §3` K4's bounded retry is corrected to "no retry", or OBX-01 gains a narrow exception, or a known failure leaves the adapter contract. **Blocks the known-failure branch** |
| **`S1J-C6`** | Whether `25 §14`'s span is corrected to propose→authorise, or a per-entity dispatch serialisation is declared, or something else. **Leaves the fourth-row residual open either way until declared** |

### The three declarations awaiting confirmation

`S1J-C3` (post-dispatch status on an append-only effect ledger), `S1J-C4`
(`DISPATCHED_AWAITING_VERIFICATION`), `S1J-C5` (the `ACOS-JCS-1` field order for
`acos.journal.dispatch_outcome.v1`).

### OPEN / PARTIAL — the full list

| Item | State |
|---|---|
| real adapter | **OPEN** |
| real network | **OPEN** |
| real vendor credentials | **OPEN** |
| real ESP sandbox six-kill-point validation | **OPEN** (`37 §2` S4) |
| **`I36` real-provider validation** | **OPEN.** Enforcement and local composition CLOSED |
| external exactly-once | **OPEN** |
| provider idempotency (and `36 §7`'s empirical measurement of it) | **OPEN** |
| provider query | **OPEN** |
| delivery webhook | **OPEN** |
| delivery reconciliation | **OPEN** |
| `VERIFIED` / `NEVER_SENT` from genuine provider evidence | **OPEN** |
| **`I20`** | **OPEN**, structurally on both sides |
| **`I8`** | **OPEN.** `37 §2` records that `I8` proves nothing at S1, and that `30 §5.5` cases 2b and 4 therefore have no operative detector |
| audit-plane vendor credentials | **OPEN** |
| settlement / `I18d` | **OPEN** |
| **`25 §14`'s propose→authorise→execute span** | **OPEN — `S1J-C6`.** `36 §2.3`'s declared VC-C3 clause is CLOSED |
| approval resume / `R′` / VC-C4 | **OPEN** |
| `I51` / `I58` / `I60` | **OPEN** |
| standing-revocation execution | **OPEN** |
| reaper / `I32` / headroom starvation | **OPEN** |
| `I17b` | **OPEN** |
| **`I17f(a)` / `(c)`** | **PARTIAL.** Local/mock composition leg only; no audit-plane evaluator, no published stall interval at dispatch time, no provider observation. `I17c` scheduler leg **OPEN** |
| **control-artifact signatures 3, 20, 27** | **OWED. Class 20's obligation GREW at S1J** |
| runtime `I19` | **OPEN** |
| Cedar `O4` | **OPEN** |
| symcc | **DEFERRED** (`45 §3`, recorded as a formal amendment) |
| AI CEO / workers | **OPEN** |
| **MIE consumption at the execution/outcome point** | **OPEN — `S1J-C1`** |
| **a known-adapter-failure local state** | **OPEN — `S1J-C2`** |

### THE PRE-LIVE-EXECUTION CONTROL-ARTIFACT GATE

**Carried forward from S1I, unchanged and undischarged.** Class 3 signature owed; class 20
signature owed **and extended again by S1J**; class 27 signature owed; runtime `I19` OPEN;
Cedar `O4` OPEN where distinct; production key management OPEN.

S1J may proceed because its adapter is a deterministic in-process mock with no credential, no
network, no customer, no real money and no real external write.

> ## NO LATER SLICE MAY ENABLE A REAL VENDOR CALL WITHOUT RE-EVALUATING AND SATISFYING THE
> ## CURRENT PRE-LIVE-EXECUTION CONTROL-ARTIFACT GATE.

---

## 22. Recommended Next Slice

**S1K — the owner-resolution pass on `S1J-C1`, `S1J-C2` and `S1J-C6`, and the MIE
reservation/consumption mechanics it declares.**

Named only. Not implemented. **No real vendor, no sandbox, no credential and no provider
work may begin before that resolution and before the pre-live-execution control-artifact
gate is re-evaluated.**
