# S1E — Implementation Log

Chronological record of what was built, what it cost, and the four points at which the
implementation changed direction because the repository disagreed with the plan.

---

## 0. Baseline

| | |
|---|---|
| Required baseline | `0054e5f` |
| Worktree at start | clean |
| `0054e5f` resolved to | `0054e5fa7674028cfb3e6fc5a045586c3b5518a7` — the expected commit |
| Branch created | `feature/s1e-pre-reservation-authority`, fresh, off `0054e5f` |
| Baseline `npm run verify` | **exit 0** — typecheck green, lint green with zero warnings |
| Baseline counts | **58 test files, 756 tests, 756 passed** |

The baseline was re-run before any file was edited, so the 756 figure is measured on this
machine rather than quoted from `S1D-result.md`.

---

## 1. Architecture read before any code

`26 §7` and `§7.1` in full; `26 §1`–`§6`, `§11.2`, `§13`, `§14`; `24 §5`–`§8`, `§10`–`§15`,
K1/K3/K5/K7/K9/K12/K14; the invariant registry including the MVP set and the DB-enforced
enumeration; `36 §2`, `§3`, `§10`; `37 §2`; `51 §2`, `§3.1`, `§4.7`.

Step J was read rather than inferred, per the mandate. Its result is recorded in
`S1E-contract.md §2.1`.

---

## 2. What was built

### 2.1 Migration `0006__authority.sql` — 654 lines

Fourteen tables across five groups: step D's identity substrate; step F's platform status and
agent profile; steps G–H″'s state facts, contradiction links and per-class precondition
declarations; step I–L's grants and evidence; step N's autonomy ledger.

Two columns are computed by the database rather than written by anything:

* `state_fact.grade` is `GENERATED ALWAYS AS (...) STORED` over the writer's identity, per
  `24 §5` and `I5`. PostgreSQL refuses an INSERT or UPDATE that supplies one.
* `principal` has **no `delegation_depth` column at all** — `26 §3` rule 3's cap is counted
  from `delegation_hop` rows at step D, because a cap compared to a figure its subject stored
  is `26 §1` Corollary 3 wearing a different hat.

### 2.2 `src/kernel/authority/` — 18 modules, ~3,150 lines

| Module | Step | Notes |
|---|---|---|
| `steps.ts` | — | `26 §7`'s labels and ORDER as a declared constant |
| `errors.ts` | — | The category / internal-detail split, both closed unions |
| `principal.ts` | D | Session → principal; Ed25519 hop verification; counted depth; the rule-2 intersection |
| `prohibitions.ts` | E | `26 §6`'s table as a frozen constant; one-argument evaluator |
| `platformStatus.ts` | F | Absent row denies |
| `preconditions.ts` | G/H/H′/H″ | Fetched once, examined three times in `26 §7`'s order |
| `resourceSelector.ts` | I | The closed three-form predicate language |
| `grants.ts` | I | Matching, and the narrowest-bound intersection |
| `recoverability.ts` | J | Two operands, both kernel-owned |
| `counterparty.ts` | K | Applicability from the catalogue; fails closed in both directions |
| `evidence.ts` | L | `24 §13` corroboration, computed |
| `autonomy.ts` | N | The four-part key; `REQUIRE_APPROVAL`, not a denial |
| `channel.ts` | P | Fails closed while `26 §9` is undeployed |
| `immutability.ts` | — | Deep runtime freeze of the canonical effect |
| `preReservation.ts` | all | The pipeline, with a construction-time order assertion |
| `preReservationResult.ts` | — | The non-dispatchable terminal |
| `workerFacingAuthorityDenial.ts` | — | The coarse projection |

### 2.3 Tests — 8 files, 145 tests, 5 new vulnerable controls, 2 new compile-negative fixtures

Detailed in `S1E-test-matrix.md`.

---

## 3. Four points where the repository disagreed with the plan

Recorded because each one changed the implementation, and because a log that reports only the
successful path is not a log.

### 3.1 `PrincipalKind` did not match `26 §3`

The plan assumed the accepted `ResolvedPrincipal` already carried `26 §3`'s five kinds. It
carried `'AGENT' | 'HUMAN' | 'KERNEL_SERVICE'`. Step D and the `§7.1` branch both key on
`kind`, so the union was corrected rather than worked around. Blast radius: one type
declaration, two fixture literals, no control artifact, no policy digest movement.
Recorded as S1E-C6.

### 3.2 The grant's `irrecoverable_units` column broke an accepted S1A assertion

`26 §4` prints `per_action_max { monetary?, irrecoverable_units? }` and the first migration
draft stored both. `tests/integration/exposure/irrecoverable-standing-zero.test.ts` asserts an
EXACT set of the schema's irrecoverable columns, so that a future forward-exposure quantity
cannot be added quietly — and the new column broke it.

Two options: widen the accepted assertion, or drop the column. **The column was dropped**, on
S1B.1's precedent for `declaredWindows`: nothing in S1E reads it, irrecoverable counts bind at
step R against `W_*_MIE`, and a stored authority quantity with no enforcer is exactly the
field S1B.1 removed. Recorded as S1E-C5. The accepted assertion is byte-identical.

### 3.3 The outcome record's free-text audit note broke an accepted S1B rule

`tests/canonicalisation/worker-facing-denial.test.ts` asserts that nothing in `src/` outside
the denial types reads `.auditNote`. The first `PreReservationDenied` carried one.

Again two options: add S1E to the rule's exemption list, or stop carrying the string. **The
string was dropped** in favour of the closed `(step, code, detail)` triple, and
`AuthorityDenied` was rewritten to use TypeScript parameter properties so that even the
class's own constructor never writes the `.auditNote` form. Recorded as S1E-C7. The accepted
rule is byte-identical and its exemption list is unchanged.

### 3.4 The lease-continuity test's first design could not detect a release

The first draft started the competing session BEFORE session A acquired the lease, so the
competitor won the race, took the lock, released it and was gone before A's barrier — and the
test timed out looking for it in `pg_locks`. The second draft starts the competitor from
inside A's lease callback, waits for it to appear in `pg_locks` as an UNGRANTED row, and
samples "has the competitor been granted the lock yet?" from INSIDE the barrier rather than
after the span. That removes the interleaving in which a release could go unobserved.

---

## 4. Ordering decision inside step D

`26 §7` places D after C′. S1E resolves the principal FIRST and then runs C′ with it, because
`26 §2.1` requires the request's principal to be "stamped by the kernel" and C′ is where the
request is stamped — resolving it afterwards would mean C′ stamped something unverified.

The GATE is still step D: the denial code, the step label and the recorded step sequence all
say `D`, and there is no gate between C′ and D to be reordered past. The
`stepsEvaluated = ['D']` assertion on a C′ denial makes the sequencing visible rather than
implicit.

The same reasoning applies to grant resolution: `26 §2.1` puts `window_refs[]` on the request,
so the matching grant set must be READ before C′ builds it. The read decides nothing; step I
is the gate, it re-resolves on the same held lease, and it denies if the two disagree.

---

## 5. Verification

| Run | Result |
|---|---|
| `npm run typecheck` | green |
| `npm run lint` (`--max-warnings 0`) | green, zero warnings |
| `npm run test` | **66 files, 901 tests, 901 passed, 0 failed, 0 skipped** |
| `npm run verify` | **exit 0** |
| Focused S1E suites | **8 files, 145 tests, 145 passed** |
| Real-PostgreSQL S1E tests | 106 |
| Accepted tests still present | 756 of 756 (`901 − 145 = 756`) |

`package.json` and `package-lock.json` are byte-identical to `0054e5f`: no dependency was
added, removed or moved. `docs/architecture/` is untouched.
