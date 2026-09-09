# S1J — Contract

**Package issue `v1.3.4` is authoritative. Accepted predecessor: `e5b356a` (S1I).
Branch: `feature/s1j-mock-dispatch-outcomes`.**

**MOCK TRANSPORT ONLY. NO REAL ADAPTER, NO NETWORK, NO VENDOR CREDENTIAL, NO PROVIDER
OUTCOME.**

---

## 0. What S1J is, in the architecture's own sequencing

`phase2-v1.3.4-errata.md` SEQ-01 split ADR-026 across two slices and named the second
one's contents. `37 §2` prints the same list:

> **LATER EXECUTION / ADAPTER SLICE — everything that needs a vendor:**
>
> - the real adapter and the HTTP or vendor-SDK call;
> - provider idempotency headers and the provider query primitive;
> - **the unknown-outcome runtime transition and `PRESUMED_EXECUTED`;**
> - **MIE consumption at the execution/outcome point;**
> - the provider sandbox, delivery-event reconciliation, `VERIFIED` and `NEVER_SENT`;
> - `I36`'s declared verification — the six kill points of `44 §5.2` against a **real ESP
>   sandbox**, measured by the provider's own accepted count — and `I20`.

**S1J builds the KERNEL-SEMANTICS half of that list against a deterministic in-process
mock, and none of the vendor half.** The two bullets in bold are S1J's subject; the other
four are not, and `no-real-transport-boundary.test.ts` asserts each as an absence over the
whole of `src/`.

**`37 §2` S1 independently puts a mock here**: its closed catalogue has "exactly three
classes: one REVERSIBLE, one COMPENSABLE, one IRRECOVERABLE, **all against a mock
adapter** — plus one rate-based class against a mock". A mock at this stage is
architecture; a mock in `src/` would be a second production write path, which `48 §1` says
the perimeter exists to make impossible.

---

## 1. The composition S1J adds

```
LOCAL AUTHORISATION COMMITTED  (S1F, accepted)
  → durable ENQUEUED outbox row  (S1I, accepted)
  → claim-time authority evaluation against CURRENT state  (S1H + S1I, accepted)
  → exclusive durable CLAIM
  → COMMIT
  ────────────────────────────────  everything below is S1J  ───────────────────────
  → fresh-claim dispatch capability, minted by that commit, in this process only
  → trusted closed adapter resolution from the committed adapter identity
  → EM6 eligibility check, BEFORE invocation
  → frozen dispatch envelope over the PERSISTED payload snapshot
  → adapter.dispatch(envelope)          ← the ONLY invocation surface in src/
  → typed adapter outcome, attested in-process
  → recoverability-keyed outcome policy  (25 §10)
  → ONE local outcome transaction: journal row + outcome row
  → STOP
```

**Nothing after `STOP`.** No provider query, no delivery webhook, no reconciliation, no
`VERIFIED`, no `NEVER_SENT`, no settlement.

---

## 2. Files

### Production — control plane

| File | What it is |
|---|---|
| `src/db/migrations/0012__dispatch_outcome.sql` | `effect_dispatch_outcome`, the `DISPATCH_OUTCOME` journal row kind, branch 7 of `effect_journal_canonical_bytes`, `emit_dispatch_outcome` |
| `src/kernel/gateway/adapterPort.ts` | The adapter PORT, the frozen `DispatchEnvelope`, the typed `AdapterOutcome`, `25 §7`'s EM6 capability set. **No implementation.** |
| `src/kernel/gateway/adapterRegistry.ts` | Trusted closed resolution by catalogue identity; the EM6 predicate; `EMPTY_ADAPTER_REGISTRY` |
| `src/kernel/gateway/dispatchCapability.ts` | The fresh-claim capability and the invocation attestation, both process-local and unforgeable |
| `src/kernel/gateway/dispatchEnvelope.ts` | Builds the frozen envelope from ONE committed row. Imports no constructor. |
| `src/kernel/gateway/outcomePolicy.ts` | `25 §10`'s table as a pure total function over two trusted operands |
| `src/kernel/gateway/outcomeTransaction.ts` | The one local outcome transaction |
| `src/kernel/gateway/effectGateway.ts` | The sole production dispatch composition path |

### Production — audit plane and transport

| File | Change |
|---|---|
| `src/audit/db/migrations/A0007__dispatch_outcome.sql` | The kind, the three columns, the audit plane's INDEPENDENT branch 7, the widened ingest signature |
| `src/audit/transport/journalRecord.ts` | `'DISPATCH_OUTCOME'` and its three fields |
| `src/replication/journalPusher.ts` | The three columns, named onto the wire |
| `src/audit/ingress.ts` | Three more bound parameters, 45 → 48 |

**`src/kernel/outbox/` IS UNTOUCHED.** The accepted S1I claim is imported, not modified,
and not wrapped: `claim.ts`, `enqueue.ts`, `recovery.ts`, `outboxState.ts` and
`correlationTag.ts` have byte-identical content to `e5b356a`.

---

## 3. The five declarations S1J makes, and the two conflicts it reports

Each is an owner clarification in `S1J-owner-clarifications.md`. **`S1J-C1` and `S1J-C2` are
the two that make this slice PARTIAL.**

| Id | Subject | Kind |
|---|---|---|
| **S1J-C1** | "Consume the irrecoverable unit" has no declared ledger mutation, and no accepted slice reserves a unit | **ARCHITECTURE INCOMPLETENESS — PARTIAL** |
| **S1J-C2** | `24 §3` K4's known-adapter-failure response contradicts `25 §7` OBX-01 and declares no state | **ARCHITECTURE CONFLICT — PARTIAL** |
| **S1J-C3** | An append-only `effect` ledger has no declared mechanism for carrying a post-dispatch status | Implementation declaration |
| **S1J-C4** | No identifier is declared for the effect's state between "adapter returned" and `VERIFIED` | Implementation declaration |
| **S1J-C5** | `30 §5.3a` declares a field order for one row kind, and S1J puts a second in service | Implementation declaration |
| **S1J-C6** | `25 §14`'s entity lease spans propose→authorise→**execute**, and OBX-03's asynchronous claim cannot hold it | **ARCHITECTURE CONFLICT — REPORTED, VC-C3 PARTIAL** |

---

## 4. The states and the outcome taxonomy

### 4.1 The typed adapter outcome — three kinds, two implementable

| Kind | Architecture source | Implemented? |
|---|---|---|
| `ADAPTER_RETURNED` | `25 §5`: "EXECUTING --> VERIFYING: **adapter returned**" | YES |
| `OUTCOME_UNKNOWN` | `25 §5`: "timeout / ambiguous"; `35 §4`'s state | YES, for REVERSIBLE and COMPENSABLE |
| `ADAPTER_FAILED` | `24 §3` K4: "On **adapter failure**, bounded retry…" | **NO — `S1J-C2`** |

### 4.2 The post-dispatch effect status

| Status | Source | Reached from |
|---|---|---|
| `DISPATCHED_AWAITING_VERIFICATION` | **Implementation declaration, `S1J-C4`** | `ADAPTER_RETURNED`, every class |
| `DISPATCHED_OUTCOME_UNKNOWN` | `35 §4`, verbatim | `OUTCOME_UNKNOWN`, REVERSIBLE and COMPENSABLE only |

**`VERIFIED`, `PRESUMED_EXECUTED`, `NEVER_SENT`, `DISPATCHED`, `EXECUTED` and `SETTLED`
appear nowhere in `src/`**, and the ACCEPTED `no-transport-boundary.test.ts` still asserts
each as an absence — unamended by S1J.

### 4.3 `25 §10`'s table, as implemented

| Recoverability | Outcome | Local state | Economic movement | Redispatch |
|---|---|---|---|---|
| REVERSIBLE | `ADAPTER_RETURNED` | `DISPATCHED_AWAITING_VERIFICATION` | `NONE` | never |
| COMPENSABLE | `ADAPTER_RETURNED` | `DISPATCHED_AWAITING_VERIFICATION` | `NONE` | never |
| IRRECOVERABLE | `ADAPTER_RETURNED` | `DISPATCHED_AWAITING_VERIFICATION` | `NONE` | never |
| REVERSIBLE | `OUTCOME_UNKNOWN` | `DISPATCHED_OUTCOME_UNKNOWN` | `NONE` — reservation HELD | never |
| COMPENSABLE | `OUTCOME_UNKNOWN` | `DISPATCHED_OUTCOME_UNKNOWN` | `NONE` — reservation HELD | never |
| IRRECOVERABLE | `OUTCOME_UNKNOWN` | **NOTHING WRITTEN — `S1J-C1`** | none | never |
| any | `ADAPTER_FAILED` | **NOTHING WRITTEN — `S1J-C2`** | none | never |

**`economic_movement` is `NONE` on every declared branch, and that is an architecture
result rather than a simplification.** `25 §5`: "A 200 from an API is not evidence that the
world changed. Verification is an independent read-back — and for money, it is the
settlement reconciliation, not the API response." `35 §4`: the reservation "**remains
held**. It is not released on timeout". Holding is the absence of a movement, and `24 §3`
K5's realised term is fed by settlement events `28 §4` owns and S1J does not build.

The hand-authored oracle for this table is `tests/support/s1jOutcomeTable.ts`, which
imports nothing.

---

## 5. `acos.journal.dispatch_outcome.v1` — THE DECLARED FIELD ORDER

**THIS SECTION IS THE SPECIFICATION FOR THE ROW KIND'S BYTE ORDER, AND IT IS AN
IMPLEMENTATION DECLARATION — `S1J-C5`.**

`30 §5.3` requires a hashed row's column order to be *"Fixed, declared per row kind, **in
the specification**"*. `30 §5.3a` — v1.3.4's answer to `S1I-C4` — is that specification for
`acos.journal.outbox_claimed.v1` and for **no other kind**, and says: *"The remaining kinds
are declared as they are cross-implemented; **a row kind in service without a declared
order here is a defect of this class.**"*

S1J puts a second kind in service. The order below is offered to the owner in exactly the
position `S1I-C4` occupied before `§5.3a` existed.

| # | Field | Type | Note |
|---|---|---|---|
| 1 | `'acos.journal.dispatch_outcome.v1'` | text | domain tag |
| 2 | `company_id` | text | |
| 3 | `journal_seq` | int | `30 §5.2`'s gap-free company-scoped sequence |
| 4 | `'DISPATCH_OUTCOME'` | text | the row kind |
| 5 | `outbox_id` | text | joins to the `OUTBOX_CLAIMED` row for this attempt |
| 6 | `outbox_claim_id` | text | the specific claim this outcome belongs to |
| 7 | `outbox_correlation_tag` | text | what a future delivery event would match on |
| 8 | `effect_id` | text | joins to the `EFFECT_AUTHORISATION` row |
| 9 | `authorisation_id` | text | |
| 10 | `idempotency_key` | text | `25 §7`'s deterministic effect key |
| 11 | `action_class` | text | |
| 12 | `resource_ref` | text | |
| 13 | `dispatch_payload_hash` | text | the hash the authorisation bound |
| 14 | `dispatch_adapter` | text | the catalogue-assigned adapter that was invoked |
| 15 | `dispatch_outcome_kind` | text | the TYPED result the trusted adapter returned |
| 16 | `dispatch_effect_status` | text | the local status `25 §10`'s policy produced |
| 17 | `outbox_requires_unmirrored_tag` | bool | `30 §5.7.2` item 5 / `36 §6`. **REQUIRED-PRESENT** |
| 18 | `override_id` | text, **NULLABLE** | `30 §5.7.2` item 5's specific authority |
| 19 | `occurred_at` | ts | RFC 3339, UTC, 6 fractional digits |
| 20 | `prev_hash` | bytes | the chain link |

**Required-absent on this kind:** `decision_id`, `reservation_id`, `approval_id`,
`verdict`, `vendor_amount`, `total_exposure`, `forward_integral`, `is_rate_class`, the
constructor version, `policy_version`, the attestation triple, the mirror/corroboration
columns, `override_event`, `override_actor`, `outbox_matched_row`, `outbox_mirror_state`
and `outbox_claim_clock_ref`.

**Why `outbox_matched_row`, `outbox_mirror_state` and `outbox_claim_clock_ref` are
absent.** Each is a fact about the CLAIM and is already in the chained `OUTBOX_CLAIMED` row
this one joins to on `outbox_id` and `outbox_claim_id`. `30 §5.3a`'s own rule: *"duplicating
an authority-bearing value into a second chained row creates a second place it can disagree
with itself."* The authorisation block is absent for the same reason, one row further back.

**Why field 17 is REQUIRED-PRESENT.** `§38` of the S1J mandate requires the audit plane to
be able to determine, from its OWN holdings, that a dispatch which required
`DISPATCHED_UNMIRRORED` carried the requirement across the port. A row that could omit it
would make that determination impossible from the audit plane's side.

**Every field is a scalar.** `30 §5.3`'s RFC-8785 leg is not engaged by this kind.

### The two obligations this section creates, carried forward verbatim from `30 §5.3a`

> **The order is normative, not conventional.** A control-plane implementation and an
> audit-plane implementation must each transcribe **this table** independently. Neither may
> read the other, and neither may read a shared canonicalisation helper that would make
> agreement automatic.
>
> **The order may not depend on an object's or a map's insertion order** in any
> implementation, and a seeded swap of two fields of this row kind must make the
> byte-identity fixture fail.

Both are discharged: `0012` (control) and `A0007` (audit) are independent positional
concatenations, `tests/support/jcs1Oracle.ts`'s `dispatchOutcomeFields` is the hand-authored
third reading, and `dispatch-outcome-journal-rows.test.ts` seeds the swap of fields 15 and
16 — same type, same framing, adjacent positions, so only the ORDER distinguishes the two
byte strings.

### Control-artifact effect — DISCLOSED, NOT DISCHARGED

`ACOS-JCS-1` is control artifact **class 20** (`50 §2`), whose signed content is *"column
order per row kind"*. **Declaring an order for a row kind that had none moves class 20's
`content_hash` and therefore its signature.** That signature has been owed since v1.3.2's
NULL-framing correction, v1.3.4 extended the obligation for `OUTBOX_CLAIMED`, and **S1J
extends the same owed obligation again and discharges nothing.** No deployed chain exists,
so no re-anchor procedure is triggered.

---

## 6. The fresh-claim capability — `§5`

**The property:** a persisted `CLAIMED` row is not sufficient to invoke an adapter.

**The mechanism:** an opaque frozen object with no own data, keyed into a module-private
`Map` in `dispatchCapability.ts`.

| `§5` requirement | Mechanism | Asserted by |
|---|---|---|
| minted only by the successful claim | one production call site, `effectGateway.ts`, on the line after the claim commits | `no-real-transport-boundary.test.ts` |
| bound to exact identity | company, idempotency key, outbox, effect, claim — all five compared on consume | `fresh-claim.test.ts` |
| usable at most once | `consume` deletes the entry before returning | `fresh-claim.test.ts` |
| not serializable | no own enumerable properties; `toJSON` THROWS | `fresh-claim.test.ts` |
| not reconstructable from a `CLAIMED` row | no exported function takes a row, an `outboxId` or a `claimId` and returns one | export-surface assertion |
| not accepted from input | a private `unique symbol` brand; a fabricated or cloned object is not a `Map` key | type-negative fixture + runtime |
| lost on process death | the `Map` is process memory; nothing persists, caches or derives it | kill-point matrix |

**And it does not outlive one call, on any path.** The gateway wraps everything after the
mint in a `try`/`finally` that revokes, so a refused resolution, a kill point, an adapter
that throws or a failed outcome transaction all leave `liveCapabilityCount() === 0`.

**The invocation attestation** is the same trick one step later, and is deliberately NOT
single-use: a local outcome transaction may legitimately be retried, and re-invoking the
adapter to obtain a fresh attestation is precisely the duplicate `I36` forbids. `§25`'s
exactly-once property comes from the outbox row lock and `effect_dispatch_outcome`'s
primary key.

---

## 7. Schema — `effect_dispatch_outcome`

**Why a separate table.** `25 §7` (OBX-01) admits "no transition out of `CLAIMED`, and no
second transition into it", and `0010`'s `dispatch_outbox_state_machine` trigger refuses
every UPDATE to a `CLAIMED` row. So an outcome cannot be a column on that row without
weakening the trigger. `§26`'s "every outcome branch remains non-reclaimable" is therefore
true by construction: nothing in the outcome transaction touches `dispatch_outbox`.

**Why not a column on `effect` either.** `0007`'s `effect` carries `acos_append_only` and
`CHECK (status IN ('AUTHORISED', 'AWAITING_APPROVAL'))`, with `33 §6` making a correction "a
new row with supersedes". There is no UPDATE path for any role. `S1J-C3` records that v1.3.4
declares no mechanism for an append-only effect ledger to carry a post-dispatch status, and
declares one: the outcome row carries it, one row per outbox identity, and an effect's
effective status is `effect.status` until an outcome row exists and that row's
`effect_status` afterwards.

### The constraints that are the state machine

| Constraint | What it enforces |
|---|---|
| `PRIMARY KEY (company_id, idempotency_key)` | at most one outcome per effect identity, forever — `§25` |
| composite FK over eight NOT NULL columns into `dispatch_outbox_claimed_identity` | an outcome only for a COMMITTED claim, of the same company, effect, adapter and recoverability — `§17` |
| `dispatch_outcome_kind_declared` | `ADAPTER_RETURNED` or `OUTCOME_UNKNOWN`. `ADAPTER_FAILED` is absent — `S1J-C2` |
| `dispatch_outcome_effect_status_declared` | the two declared post-dispatch statuses and nothing else |
| two biconditionals kind ↔ status | the transition table, in the database |
| **`dispatch_outcome_irrecoverable_unknown_undeclared`** | **`NOT (IRRECOVERABLE AND OUTCOME_UNKNOWN)` — `S1J-C1` made structural** |
| `dispatch_outcome_unmirrored_tag_not_suppressed` | `unmirrored_tag_sent = requires_unmirrored_tag` — `§12`, `§38` |
| `dispatch_outcome_economic_movement_declared` | `= 'NONE'`. A later slice that moves money must change a migration |
| `dispatch_outcome_invocation_precedes_outcome` | `invoked_at <= outcome_at` — `§6`'s ordering, recorded |
| `effect_dispatch_outcome_append_only` | `33 §6`: a correction is a new row, never a rewrite |
| `dispatch_outcome_agrees_with_claim` trigger | the two NULLABLE claim facts an FK cannot carry: the tag requirement and the override |

**No exposure column, no amount, no MIE limit, no threshold.** `§33`: economic authority
stays in kernel state, and `26 §1` Corollary 3 puts the request with the ceiling's enforcer
rather than its subject.

---

## 8. The lock order, and the isolation level

```
1. window_balance            — NOT TOUCHED. No money moves.
2. standing_window_exposure  — NOT TOUCHED.
3. dispatch_outbox row       FOR UPDATE
4. journal_counter           FOR UPDATE, LAST, inside emit_dispatch_outcome
```

Two locks, in `30 §5.2`'s declared total order, with the counter last — the reading
`src/kernel/exposure/lockOrder.ts` records. No inversion against the S1I claim transaction
(same two, same order) and none against the S1F authorising transaction (which never
touches `dispatch_outbox`).

**`READ COMMITTED`, and `§43`'s conditional does not fire.** `33 §6` scopes the serialisable
requirement to the exposure ledger, "the only table with a serialisable-isolation
requirement", and this transaction moves no ledger term. At `REPEATABLE READ` the loser of
`§25`'s race would raise `40001` instead of reading the committed prior outcome, which
converts a determinate `alreadyResolved` into a retryable error a caller must interpret —
the same reasoning the ACCEPTED S1I claim records. **`outcomeTransaction.ts` contains no
retry loop, no backoff and no SQLSTATE inspection**, asserted over its own source, so there
is no second lock discipline to disagree with `retry.ts`.

---

## 9. What S1J does not do

- **No real adapter.** `src/` contains no `ExternalEffectAdapter` implementation, and
  `EMPTY_ADAPTER_REGISTRY` is empty, so a production process can invoke nothing.
- **No network.** No `fetch`, no `http`/`https`, no `net`/`tls`, no axios, no undici, no
  socket, no localhost server, no URL.
- **No credential.** No `process.env` read, no secret loader, no token, no API key, and no
  vendor name anywhere in `src/kernel/gateway/`.
- **No provider evidence.** No provider query, no delivery webhook, no message log, no
  `VERIFIED`, no `NEVER_SENT`, no audit-plane vendor read, no `I8`.
- **No economic movement.** `NONE` on every branch, pinned by a `CHECK`.
- **No MIE accounting.** `S1J-C1`.
- **No retry, reclaim, lease, timeout or expiry out of `CLAIMED`.**
- **No scheduler, poller or startup sweep.** `§23`'s forbidden shape is unbuildable, because
  the capability cannot be obtained from a row.
- **No control-artifact signature discharged.** Classes 3, 20 and 27 remain owed; runtime
  `I19`, Cedar `O4` and production key management remain OPEN.

---

## 10. THE PRE-LIVE-EXECUTION CONTROL-ARTIFACT GATE

**Carried forward from S1I, unchanged and undischarged.**

| Obligation | State |
|---|---|
| Control artifact class 3 signature | **OWED** |
| Control artifact class 20 signature (`ACOS-JCS-1`) | **OWED, and extended again by `S1J-C5`** |
| Control artifact class 27 signature | **OWED** |
| Runtime `I19` | **OPEN** |
| Cedar `O4` where distinct | **OPEN** |
| Production key management | **OPEN** |

**S1J may proceed because its adapter is a deterministic in-process mock with no credential,
no network, no customer, no real money and no real external write.**

> ## NO LATER SLICE MAY ENABLE A REAL VENDOR CALL WITHOUT RE-EVALUATING AND SATISFYING THE
> ## CURRENT PRE-LIVE-EXECUTION CONTROL-ARTIFACT GATE.

`phase2-v1.3.4-errata.md §6`'s own words, carried forward: *"It did not discharge any
control-artifact signature. Classes 3, 20 and 27 remain owed, and runtime `I19` remains
absent. The pre-live-execution gate recorded at S1I stands: no later slice may enable a real
external effect until owner signing and integrity sequencing have been re-evaluated."*
