# S1E — Result

## Verdict — `PASS`

S1E implements the complete worker-originated pre-reservation authority pipeline: every
currently applicable `26 §7` gate from step D to the edge that would enter step R, composed
with the accepted S1B schema/catalogue/constructor path, the accepted S1C live re-enumeration
under the entity advisory lease, and the accepted S1D real in-process Cedar decision at step
M — which is reused, not reimplemented. Every authority operand is fetched or derived by
trusted kernel code from real PostgreSQL; the principal cannot be caller-supplied because
there is no argument position for one; categorical prohibitions are evaluated before grants
and take no grant argument; missing or malformed authoritative state fails closed at every
gate; denial ordering is deterministic internally and coarse externally; the S1C entity lease
is held on one PostgreSQL backend across the whole sequence, proven with `pg_backend_pid()`
and `pg_locks` against a competing session parked in the lock queue; and the terminal result
is structurally non-dispatchable — it carries no `DispatchPayload`, no authorisation and no
reservation, and the attempt to consume it as one is a compile failure. Five new
intentionally vulnerable implementations demonstrably accept the attacks production rejects.
`npm run verify` is green at 66 files / 901 tests with all 756 accepted tests present,
unskipped and unweakened.

**Owner-resolution pass, 2026-09-07.** The four items S1E raised for the owner — S1E-C4,
S1E-C2, S1E-C3 and S1E-C6 — have been disposed of and are RESOLVED (§8). The implementation
committed at `e1b7a7f` already conformed to all four rulings, so **this pass changed no
production code, no test and no architecture file**; it changed documentation only, and
`npm run verify` is green again at the same 66 files / 901 tests.

---

## 1. Baseline

* Required baseline: `0054e5f`
* Actual starting commit: `0054e5fa7674028cfb3e6fc5a045586c3b5518a7` — the expected commit
* Fresh branch: `feature/s1e-pre-reservation-authority`
* Final commit: recorded in the owner report at the head of this session
* Worktree clean at finish: **YES**
* Baseline `npm run verify`: exit 0 — 58 files, 756 tests, all passing

---

## 2. S1E's terminal boundary

**What a `PRE_RESERVATION_PASS` means.**

> This canonical effect has passed every authority gate `26 §7` places before step R, and is
> eligible to **attempt** economic reservation.

**Why it is not final authorisation.** `26 §7` places six things between here and a dispatch
and S1E implements none of them: R (reserve atomically against every referenced window
instance), S (approval requirement), T–V (idempotency mint/verify and prior-result return),
W (PERMIT plus the SIGNED `AuthorizationDecision`) and X (the audit write). Step W is where an
`AuthorizationDecision` exists; this result is not one and is not named one.

**Step R was not implemented.** No reservation row, no `window_balance` mutation, no
four-term guard evaluation, no standing transaction, no money lock acquired. The source-rule
suite asserts the absence as a grep over `src/kernel/authority/`.

**Nothing produced by S1E is dispatchable.** `PreReservationQualified` carries the
`AuthorizationRequest` and the `dispatch_payload_hash` that binds it to a payload the caller
does not have. The payload itself — adapter, method, vendor parameters, idempotency key,
monetary effect — is held inside the pipeline and never handed out.
`tests/type-negative/prereservation-as-dispatchable.ts` makes an executor's attempt to consume
it fail to compile, and the runtime half asserts the same over the returned object's keys.

---

## 3. Entity-lease evidence — **VC-C3 PARTIAL ONLY**

| | |
|---|---|
| Advisory-lock primitive | `pg_advisory_lock(int, int)` at SESSION scope, on the lease's own checked-out connection — the accepted S1C `entityLease.ts`, unchanged |
| Backend identity | `pg_backend_pid()` on `lease.client` at acquisition, inside the post-step-P barrier, and after the sequence — **all three equal** |
| C′ session | the lease's client; `LiveSelectorCanonicaliser` runs every read on it |
| Final S1E gate session | the same client; `lease.assertHeld()` is called again before the terminal result |
| Lock holder at the barrier | `pg_locks`, read from a THIRD connection: exactly one GRANTED advisory row, pid = the lease's backend |
| Competing session | a second connection parked in a BLOCKING `pg_advisory_lock` from before the first gate — UNGRANTED at the barrier, granted only after the span ends |
| Release / reacquire observed | **NO** — sampled inside the span; one lease id spans the sequence where the vulnerable control produces two |

> **VC-C3 — PARTIAL ONLY: lease continuity proven through pre-reservation authority; full
> propose→authorise→execute span remains open.**

---

## 4. Adversarial / negative controls

| Attack | Vulnerable behaviour | Production behaviour | Does the test discriminate? |
|---|---|---|---|
| Caller-supplied principal | `unsafe-caller-supplied-principal.ts` resolves the ASSERTED id; its grant matches | The SESSION decides; the attacker resolves as itself and matches no grant; step D denies `PRINCIPAL` | **YES** — both run on one fixture and disagree |
| Ungated precondition grade | `unsafe-precondition-evaluator.ts` accepts an INTERPRETATION-grade fact | Step H denies `PRECONDITION`; Cedar is never reached | **YES** |
| Missing contradiction check | The v1.0 evaluator returns cleanly on a set in an open `ContradictionLink` | Step H′ denies `PRECONDITION_CONTRADICTED` | **YES** |
| Broad grant erasing a narrow one | `unsafe-permissive-grant-union.ts` yields IRRECOVERABLE and $250.00; step J passes | The intersection yields REVERSIBLE and $25.00; step J denies `RECOVERABILITY` | **YES** |
| Appealable prohibition | `unsafe-appealable-prohibition.ts` permits `payee.create` when a grant matches | `evaluateCategoricalProhibition` takes ONE argument and denies regardless | **YES** |
| Lease release/reacquire | `unsafe-lease-reacquire.ts` leaves the lock FREE in the gap; two lease ids | Lock held for the whole sequence, observed from another session; one lease id | **YES** |
| Asserted grade at the database | — | PostgreSQL refuses: `cannot insert a non-DEFAULT value into column "grade"` | **YES** — the engine, not application code |
| Vendor-amount policy binding (S1D) | `unsafe-vendor-amount-policy.ts` permits $26.03 | Production denies `PER_ACTION` | **YES** — accepted, still green |

Nine vulnerable controls now exist. None is reachable from `src/`.

---

## 5. Denial ordering

Ten multi-failure fixtures. Expected first gate transcribed in the test from `26 §7`'s
flowchart; see `S1E-test-matrix.md §3` for the table. The two mirrored pairs — H before H′ and
H′ before H″ — make the ordering observable in both directions rather than as an artefact of
which condition happens to be checked. In every case the worker-facing output is one frozen
field carrying one `26 §7` category, with no step, no detail, no lineage, no grant id, no
fact id and no session id.

---

## 6. Verification

| | |
|---|---|
| `npm run verify` | **exit 0** |
| typecheck | green |
| lint (`--max-warnings 0`) | green, zero warnings |
| test files | **66** (baseline 58) |
| tests | **901** (baseline 756) |
| passed / failed / skipped | **901 / 0 / 0** |
| focused S1E suites | 8 files, 145 tests, all passing |
| real-PostgreSQL S1E tests | 106 |
| new negative controls | 5 (9 total) |
| accepted tests deleted | **0** |
| accepted tests skipped or weakened | **0** |
| `.only` | **0** |
| architecture files modified | **0** |
| dependencies changed | **0** — `package.json` and `package-lock.json` byte-identical |
| owner-resolution pass (2026-09-07) | documentation only — `npm run verify` re-run green at 66 files / 901 tests, 0 failed, 0 skipped |

---

## 7. Open obligations — explicitly deferred

| Obligation | Status after S1E |
|---|---|
| Step R — reservation transaction | **OPEN.** Not implemented. The next boundary. |
| VC-C2 | **OPEN** — journaling/quota half deferred to its architecture-scheduled boundary |
| `I52` | **OPEN** — CI / spec-review half deferred to S2. Runtime projection preserved unchanged. |
| VC-C3 | **PARTIAL ONLY** — see §3 |
| VC-C4 | **OPEN** — approval-resume constructor semantics; S1E has no resume path |
| VC-A3 | **OPEN** — independent `ACOS-JCS-1` implementation |
| `ACOS-JCS-1` nullable bytes / JSON literal-null | **OPEN** — unchanged |
| `I18b` at runtime against a real reservation | **OPEN** — no S1E-created reservation exists |
| `I18d` settlement tolerance | **OPEN** |
| `I42` DB effect-idempotency uniqueness | **OPEN** — belongs to the effect/authorisation creation transaction |
| Outbox / external-effect exclusive claim | **OPEN** |
| Cedar artifact owner signing (O4) | **OPEN** — artifacts remain hash-committed |
| `I19` continuous control-artifact integrity | **OPEN** |
| symcc | **OPEN** — deferred past S1 by `45 §3` |
| Audit mirror, attestations, diff | **OPEN** |
| Real adapters | **OPEN** |
| AI CEO / workers | **OPEN** |
| Additional catalogue classes | **OPEN** — the catalogue is still the four `37 §2` names |
| `26 §7.1` KERNEL_SERVICE branch | **DEFERRED** — its prerequisite (`StandingRevocationAuthority`, created by the step-R transaction) does not exist. A kernel principal traverses every worker gate and reaches STD-03's `NO_GRANT`. |
| `26 §9` utterance policy (step P → Q) | **DEFERRED** — step P is implemented and fails closed |
| `I47` audit/SCHED leg | **OPEN** — the runtime leg is implemented at step N; the audit plane does not exist |
| v1.3.1 textual architecture cleanup | **DEFERRED** — three wording items left open by the 2026-09-07 owner dispositions: `24 §6` naming the Metric Layer and Decision Registry writers (S1E-C2), `26 §4` stating the per-action multi-grant composition rule (S1E-C4), and a declared `resource_selector.predicate` syntax (S1E-C3). Behaviour is settled; only the architecture text is outstanding, and `docs/architecture/v1.3.1/` was not edited |

---

## 8. Architecture conflicts — OWNER-DISPOSED

All four items are **RESOLVED**. The owner disposed of them in the owner-resolution pass of
2026-09-07, on top of the implementation commit `e1b7a7f`. **No item on this list requires an
owner disposition any longer, and none of the four required a production change** — the
implementation as committed at `e1b7a7f` already conformed to every ruling. The full text of
each ruling, with its conformance evidence, is in `S1E-owner-clarifications.md`.

| # | Item | Consequence | Behaviour implemented | Owner disposition |
|---|---|---|---|---|
| 1 | **Multi-grant composition of per-action bounds is undeclared** (`26 §4` declares the window arithmetic and not this). Union vs intersection differ materially. | A broad grant would silently erase a narrow restriction under the union reading | **INTERSECTION** — narrowest bound wins per dimension; window refs union, because step R fails if ANY window lacks headroom | **RESOLVED — OWNER CLARIFICATION, ACCEPTED.** INTERSECTION is ruled; the permissive/union reading is REJECTED; adding a matching grant may never widen. The union negative control is RETAINED as regression evidence. S1E-C4 |
| 2 | `24 §5` names the Metric Layer and Decision Registry as writers; `24 §6`'s `writer_kind` enum has no member for either | Representation only — no authority, money or grade ambiguity | Both represented as the `KERNEL_SERVICE` writers they are, discriminated by `derivation_spec` and `decision_authority` | **RESOLVED — ACCEPTED FOR S1; TEXTUAL ARCHITECTURE CLEANUP DEFERRED.** All five conditions of the acceptance hold; the `24 §5` / `24 §6` discrepancy is textual, not behavioural. S1E-C2 |
| 3 | `26 §4`'s `resource_selector.predicate` has no declared syntax | An open predicate language would be an interpreter on the money path | A closed three-form language; an unparseable predicate HALTS rather than silently not matching | **RESOLVED — ACCEPTED S1 SUBSET; FUTURE EXTENSION REQUIRES EXPLICIT DESIGN.** Not declared ACOS's universal or permanent selector language. S1E-C3 |
| 4 | `26 §3`'s principal kinds diverged from the accepted S1B type | Step D and `§7.1` key on `kind` | Corrected to `26 §3`'s five. No control artifact moved; the policy digest is unchanged | **RESOLVED — CORRECTION ACCEPTED.** The implementation matches the current `26 §3` and every accepted test is green. S1E-C6 |

`docs/architecture/v1.3.1/` was **not** modified by the owner-resolution pass. Items 1, 2 and
3 each leave a DEFERRED textual architecture cleanup, recorded in `S1E-owner-clarifications.md`
for a later architecture-text maintenance pass and listed in §7 above.

No conflict prevented a scoped property, so the verdict is not PARTIAL.

---

## 9. Residual risk

Stated plainly, because a slice that claims none is not credible.

* **Nothing S1E produces can move money, and nothing it produces can be dispatched** — not
  because a check forbids it, but because no reservation, authorisation, payload or adapter
  exists in the tree at all.
* **A compromised model that fully controls a worker can still**: propose any of the four
  catalogue classes, enumerate options for resources its `context_spec` admits, and drive
  denial and enumeration rates — which `29 §9` treats as compromise signals and which S1E
  does not rate-limit, because VC-C2's quota half is deferred.
* **A compromised ADAPTER remains the worst case.** Grade derives from writer identity, so an
  adapter writing at PARSER identity writes RECORD-grade facts, and `I27`'s corroboration is
  the only S1E gate that resists it — implemented for OBSERVATIONs and not applicable to
  RECORDs. `24 §10` case 6's blast radius is unchanged by S1E.
* **No external exactly-once property is claimed.** There is no outbox, no exclusive claim
  and no adapter.
* **The full propose→authorise→execute lock span is NOT proven.** Its second half does not
  exist.
* **Detection latency is unbounded**, because there is no audit plane, no attestation and no
  independent read. Every denial S1E records is recorded in memory and returned; nothing
  persists it.
* **`I8` proves nothing at S1**, per `37 §2`'s own note, and S1E does not change that.
* **The system is not production-ready** and no part of this result should be read as saying
  it is.

---

## 10. Recommended next slice

**Step R — the economic reservation transaction**, and only that.

`26 §7` puts it immediately after the edge S1E terminates at; `24 §3` K5 and `51 §2` already
declare its ledger; S1A already built and adversarially validated the four-term commitment
guard, the `window_balance` lock order and the realised/standing atomicity it needs; and S1E
now supplies the `window_refs[]` it must reserve against, resolved from matching grants under
a held lease.

It would close `I18b` at runtime, `I2`, `I31` and `I42`, and it is the prerequisite for the
`26 §7.1` KERNEL_SERVICE branch, for VC-C4's resume path and for the remaining half of VC-C3.

**It is not implemented here, and S1E stops.**
