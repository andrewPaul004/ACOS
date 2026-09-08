# S1H — Implementation Log

Chronological, with the reasoning at each decision point and every dead end that was
walked into and out of.

---

## 0. Baseline

| Check | Result |
|---|---|
| Worktree clean at start | yes |
| `HEAD` | `e47a4375268b9fb953bafb93deb90c7fc5f9f09e` |
| Required baseline | `e47a437` — matches |
| Branch created | `feature/s1h-mirror-state-machine`, from `e47a437` |
| Baseline `npm run verify` | exit 0 |
| Baseline test files | 86 |
| Baseline tests | 1204 |
| Baseline passed / failed / skipped | 1204 / 0 / 0 |
| Final commit | `ea7f60e` |
| Final files / tests / passed / failed / skipped | 104 / 1544 / 1544 / 0 / 0 |

Two PostgreSQL instances were already up from the S1G run (`acos-s1a-control` on 55432,
`acos-s1a-audit` on 55433), and both migration sets were re-applied from empty before any
S1H work, which is the repository quality gate's own requirement.

---

## 1. Reading the architecture before writing anything

The mandate names the sections to read and v1.3.2 rewards reading them in a particular
order, because three of them contain quantities the others depend on.

Read, in this order: `30 §5.1` (the ordered precedence and its rationale) → `30 §5.4`
(attestation, and what it refuses to claim) → `30 §5.6` (the three states and the
reachability table) → `30 §5.7` (who observes what) → `30 §5.7.1` (the signal contract) →
`30 §5.7.2` (the override) → `30 §9.1` (the statutory-clock contract) → `22 §3.1` (the
state-qualified precedence table, TA-10) → `24 §3` K10 and K11 → `36 §6`, `§9` (VC-A2 and
its five sub-clauses), `§14`, `§15` → `51 §3.1`, `§3.6`, `§4.1` → `50 §2` classes 20, 24,
25 → `37` S1 → the invariant registry rows for `I17`, `I17e`, `I17f`, `I56`, `I63`, and
`§3` items 7, 9 and 10 → `phase2-v1.3-lower-severity-register.md` for TA-08.

**Four things that reading settled and one it did not.**

1. **S1H is squarely inside `37` S1's declared scope.** S1 names "the three-state mirror
   machine (VC-A2), including the Path B fixture", "dispatch→tag detection (VC-A2c)", "the
   corroboration-signal contract including the reachability assertions (VC-A2d)" and "the
   override with its composition bound (VC-A2e, VC-A2f, TA-05, `I63`)". Nothing here needed
   to be argued into scope.

2. **Every load-bearing quantity the state machine needs IS declared.** `max_age` 5
   minutes (`30 §5.7.1`), `attestation_cadence` 5 minutes and `k = 3` (`30 §5.4`), and all
   eight override quantities (`51 §3.6`). `§42` of the mandate's stop condition therefore
   does not fire for the state machine itself.

3. **`30 §5.7.1`'s Provisioning note excludes the KEY and the ENDPOINT from S1**, not the
   contract: *"The signing key and the read endpoint are part of audit separation, not part
   of the S1 build, and `62 §7` authorises provisioning them now."* So the contract is
   built and the provisioning is reported OPEN. The harness generates a keypair and
   realises the "read-only bearer credential scoped to this endpoint" as a dedicated
   PostgreSQL role — the same substitution `A0001` made for the write direction.

4. **`I17f` splits cleanly along an operand boundary.** Clause (b)'s two operands — the
   audit plane's published intervals and the arrived `AUDIT_MIRROR_DEGRADED` rows — both
   exist at S1H. Clauses (a) and (c) quantify over DISPATCHED EFFECTS, which do not exist,
   so they stay OPEN and `§35` forbids manufacturing rows to close them.

**And the one it did not settle: the per-action approval floor.** Row 2 of `30 §5.1` item 4
reads "above the per-action approval floor", `50 §2` class 3 lists the floor as a field of
the signed action catalogue, and **no numeric value is declared anywhere in v1.3.2**.
`51 §3.1`'s `$25.00` is `per_action_max`, which `26 §8` makes a DENY boundary — an effect
above it never reaches dispatch precedence at all. Recorded as `S1H-C1`; the row-2
behaviour is implemented and tested over both values of the operand, and the operand's
derivation is reported PARTIAL.

**A second undeclared quantity, found later and with a larger consequence.** `30 §5.1`
item 5's "mirror lag above threshold" and "unreachable beyond a longer threshold" have no
declared values either. The three-state machine does not depend on them — `30 §5.6` enters
`UNCORROBORATED_STALL` on an OBSERVATION, not on a threshold — but the FULL-HALT POSTURE
does, and it is therefore NOT IMPLEMENTED. `S1H-C10`, and OPEN in the result.

---

## 2. The first real design decision: what is authoritative

`30 §5.6` defines each state by the conditions under which it is ENTERED, so the state is a
FUNCTION of two durable facts and one clock reading. Two designs were available.

**Considered and rejected: a stored state column as the source of truth**, mutated on each
transition. Rejected on one sentence of `30 §5.7.1`: *"Extending it by holding it is
bounded by `max_age`, **evaluated at every state evaluation and not only at entry**."* A
stored `CORROBORATED_DEGRADED` trusted on read would be a state that outlived its
corroboration, which is TA-06's defect exactly.

**Selected: the operands are authoritative and the resolved state is a cache.**
`mirror_declaration` and `mirror_corroboration` are the durable facts; `mirror_state` is
written in the same transaction as the journal row that caused the transition, and
`evaluateStateOn` RE-DERIVES on every call rather than reading it.

**The property this needed.** A cache that nobody compares to its source drifts.
`mirror-state-durability.test.ts` therefore re-derives from PostgreSQL with queries written
out IN THE TEST — not by calling `evaluateStateOn` — and asserts the stored row equals the
fresh derivation at every step of declare / corroborate / age out / close. A bug in
`evaluateStateOn`'s own reads cannot hide behind itself.

**The schema carries two of the same guards.** `mirror_state`'s
`basis_declaration_id` and `basis_signal_id` are FOREIGN KEYS to the journaled rows, so a
state claiming a basis that was never journaled cannot exist; and
`mirror_state_corroborated_names_a_signal` refuses `CORROBORATED_DEGRADED` with a null
signal basis. That is `§28`'s "do not introduce an unaudited mutable boolean" as a
constraint rather than a convention.

---

## 3. Reading `30 §5.6`'s table, and the ambiguity in it

`30 §5.6` gives `CORROBORATED_DEGRADED` ONE entry condition — a held valid signal — and
gives `UNCORROBORATED_STALL` TWO: the mirror observed unreachable AND no valid signal. Read
as three independent predicates, "mirror acknowledging AND a valid signal held" satisfies
both `NORMAL` and `CORROBORATED_DEGRADED`, and the table declares no precedence.

That is the shape of AUD-05 one level up — the defect `30 §5.1` item 4 was rewritten as an
ordered first-match list to remove — so it seemed unlikely to be intended.

**Selected: the mirror observation is the outer discriminator, the signal is the inner
one.** It is the only reading under which the three rows partition the space, and it is the
stricter one: it cannot reach the relaxed state on the signal alone.

**Checked that the choice changes no authority before making it.** `22 §3.1` gives
precedence row 3 "Dispatch" in `NORMAL` and "Dispatch, tagged" in `CORROBORATED_DEGRADED`,
so the contested combination dispatches under either reading. The choice is about the TAG
and the incident, not about eligibility — which is what made it safe to select rather than
escalate. `S1H-C2`, with both readings quoted and the residual stated.

**What the residual is.** Under the selected reading, holding a fresh signal while
declaring nothing resolves to `NORMAL`. `resolveMirrorState` reports that as the
`SIGNAL_HELD_WITHOUT_DECLARATION` anomaly — which is `I17f(b)`'s own condition — rather
than silently.

---

## 4. Building the audit side first, so the control side could not cheat

Written in this order deliberately: the audit-side observation and issuance BEFORE the
control-side verification, so the control side had to be written against an artifact it did
not produce.

**`observeStall` reads two things and nothing else.** `evaluateTransportCompleteness` — the
ACCEPTED S1G evaluator, over `audit_journal` alone — and the audit store's own reachability,
by querying it. `30 §5.7`'s table says both are unforgeable: the attestation absence
because "it is an absence observed by the other party", the probe because it is
"audit-internal".

**There is no parameter for an audit-health boolean, a control mirror flag or a
`mirrored_at` reading.** `plane-independence.test.ts` (accepted, S1G) already asserts that
no file under `src/audit/` names `controlUrl` or a control repository, and it still passes.

**The reason enum forced a decision.** `30 §5.7.1` declares three reasons and declares a
derivation for none of them. `ATTESTATION_STALL` derives cleanly from the holdings. The
audit store's own reachability gives `PUSH_PATH_UNREACHABLE` in principle — but if the
store cannot answer, the audit plane cannot publish either, which is `30 §5.6`'s "Audit
store down | No — its own checks cannot run", so `observeStall` returns `null` rather than
an observation it could not record.

`STORE_WRITE_REJECTED` has no derivation at all, and the one candidate — quota saturation —
is **explicitly forbidden** as a mode transition by `30 §5.1` item 5 and by `30 §5.6`'s own
reachability row. So `observeStall` never returns it, `vc-a2d-signal-authenticity.test.ts`
asserts that a saturated quota produces `AUDIT_QUOTA_SATURATED` and NO signal, and the leg
is reported PARTIAL under `S1H-C8`. The enum member is still accepted on the VERIFICATION
path, so declaring a derivation later needs no control-side change.

---

## 5. Where the signal's bytes are built, and why in three places

`30 §5.7.1`: *"Ed25519 over `ACOS-JCS-1` canonical bytes of the fields above."* Three
questions followed: who canonicalises, who signs, and what the verifier checks against.

**Considered and rejected: canonicalise in the audit TypeScript process.** Rejected on
`I17d`'s own reasoning as `src/audit/ingress.ts` already states it: a canonicaliser in the
writing process is a canonicaliser the writing principal executes.

**Considered and rejected: have the control plane verify against the audit plane's own
`signed_bytes`.** This is the tempting shortcut — the bytes are right there in the row —
and it is `30 §5.9`'s defect one level up: a signature checked against bytes the SIGNER
chose is a signature over the signer's own assertion. It would let anyone who could answer
the fetch sign a byte string that does not mean what the fields say.

**Selected: the audit DATABASE canonicalises, the audit PROCESS signs, and the control
plane builds the bytes AGAIN from the structured fields it fetched.**

- `A0002`'s `audit_mirror_signal_canonical_bytes` constructs them with `audit_jcs1_*` on
  the instance that owns the artifact.
- `issueSignal` signs those bytes with the Ed25519 private key and stores both.
- `audit_mirror_signal_bind_bytes` refuses the row unless the store's own recomputation
  from the structured columns EQUALS what was signed — the same discipline `A0001` applies
  to `transmitted_bytes`.
- `corroborationSignal.ts` builds the bytes a third time, in TypeScript, and verifies the
  signature over ITS OWN construction. **`SignalWire` has no `signed_bytes` field**, and
  `corroborationFetch.ts` does not select the column.

So three things hold of a stored row simultaneously: the signature covers the audit store's
`ACOS-JCS-1` bytes; those bytes are the store's own canonicalisation of the columns; and a
canonicaliser divergence is a VERIFICATION FAILURE rather than a silent disagreement. A
hand-authored fourth reading in `tests/support/jcs1Oracle.ts` judges all three.

---

## 6. The freshness rule, and a gap in it

`30 §5.7.1`'s rule is `now − observed_at ≤ max_age` **and** `now < expires_at`. Both
conjuncts are implemented, and they are NOT redundant even though the schema binds
`expires_at = observed_at + 5 minutes`: the first is non-strict and the second is strict,
so a signal evaluated EXACTLY at the boundary passes the first and fails the second. The
boundary therefore REJECTS, and the tests pin it at the millisecond.

**The gap.** If `observed_at > now`, the first conjunct's left side is negative — which
satisfies `≤ max_age` — and the second holds. The declared conjunction ADMITS a
future-dated signal.

**What was not done.** No tolerance quantity was invented; `§42` forbids it.

**What was done.** A REFUSAL was added: `observed_at > now` yields
`SIGNAL_FUTURE_DATED`. A refusal cannot unlock authority, so it cannot move any row of
`VC-A2`'s inversion table in the permissive direction — which is the test that makes the
addition safe rather than a guess. Recorded as `S1H-C6` and labelled in the source as an
addition rather than a quotation.

---

## 7. The precedence classifier, and the array that is the point

`30 §5.1` item 4 is an ORDERED FIRST-MATCH LIST and AUD-05 is what happens when it is not
treated as one. Three implementations were considered.

- **A `switch` on recoverability.** Rejected: row 2 cuts across every class, so the switch
  would need the ordering encoded in each arm and the ordering would stop being visible.
- **A predicate map keyed by row number.** Rejected: a map's iteration order is a property
  of how it was built. `§22` of the mandate names exactly this.
- **Selected: a literal array of five predicates, in the architecture's order, evaluated
  first-match, with the matched row number in the output.**

The row number in the output is what makes `VC-A6` checkable. "The right answer for the
wrong reason" is how an unordered implementation passes an outcome-only test, so
`vc-a2-inversion.test.ts` asserts `matchedRow` on all 72 rows, not only the disposition.

**Row 4's redundant conjunct is deliberate.** First-match makes `!clockBearing` redundant
in row 4 — row 3 would already have matched — and it is written out anyway, so the
predicate reads correctly in isolation AND so a reordering changes the OUTCOME rather than
silently producing the same answer. `unsafe-precedence-order.ts`'s
`UNSAFE_ROW_4_BEFORE_ROW_3` drops that conjunct, as an order-dependent implementation
would, and is shown to SUSPEND the clock-bearing refund that production DISPATCHES.

**The other permutation does not discriminate, and the suite says so.**
`UNSAFE_ROW_3_BEFORE_ROW_2` implements the order `30 §5.1` explicitly forbids — "Row 2
before row 3" — and at the four action classes the S1 catalogue declares, no effect
separates it from production. Reported as a non-discriminating control rather than counted
as evidence, which is `36 §0`'s discipline applied honestly.

---

## 8. `aboveApprovalFloor` as a declared operand

Row 2 needs the floor. `S1H-C1` records that v1.3.2 declares no numeric value. Three
options:

- **Use `per_action_max` ($25.00).** Rejected: `26 §8` makes it a DENY boundary, so an
  effect above it denies `PER_ACTION` and never reaches precedence. Row 2 would be dead
  code dressed as an implementation.
- **Invent a floor.** Forbidden by `§42`.
- **Selected: take the predicate as a declared authoritative operand**, supplied by
  `26 §12`'s approval machinery which `37` S5 builds, and test the row-2 behaviour over
  both values of the boolean in all three states.

So the BEHAVIOUR is closed and the DERIVATION is PARTIAL, and the result says which is
which.

---

## 9. The override, and the three ways it cannot become a budget override

`30 §5.7.2` semantics item 1 is the property: *"It changes no ceiling. [...] The override
releases a **dispatch gate**, never an exposure gate."* `§15` of the mandate asks for a
"database/type/source test".

**Structural, in the schema.** `degraded_mode_override` has no column naming a window, a
grant, a reservation, a standing authorisation, a `per_action_max` or a `MAL` term, and its
only foreign keys are to `company`, `principal` and `incident`. Its one monetary column is
a ceiling on its OWN consumption, bounded at $50.00 by a CHECK.

**Structural, in the source.** No statement in `src/kernel/mirror/` or
`src/kernel/clocks/` names a money relation.
`override-cannot-widen-ceilings.test.ts` scans both directories.

**Cryptographic.** Every bound the owner consents to is a SIGNED FIELD of
`overrideGrantFields` — the classes, the rows, the time box and both caps — so a handler
that widened one after the signature produces a signature that no longer verifies. The test
signs a $1.00 / 1-effect grant, presents a $50.00 / 5-effect one with that signature, and
gets `OVERRIDE_SIGNATURE_INVALID`.

**And behaviourally.** A MAXIMUM override is granted and consumed, and every
`window_registry` ceiling, every `window_balance` term across all four of `I3`'s terms,
the whole grant set, and a recomputed `MAL_monetary(month)` of `$300.00` are byte-identical
before and after.

---

## 10. `I63(b)`, and the window enumeration that took two attempts

Registry `I63(b)` is *"over **any** rolling 30-day window per company"*.

**First attempt, wrong: a single look-back from the candidate.** Count the records in
`(candidate − 30 days, candidate]`. Simple, and it MISSES a violating window anchored at an
earlier record — which is precisely `30 §5.7.2` item 10's "expiry-and-recreation" evasion.
Caught while writing the oracle, before either was finished, because the oracle had the
same bug and the two agreed with each other. That is the failure mode `36 §0` warns about,
arrived at from the inside.

**Second attempt, and what is implemented.** For a finite set of records, every 30-day
window's membership equals that of a window beginning at some record's own `starts_at` —
sliding the window right until its left edge hits a record can only remove members. So
enumerating the windows anchored at records enumerates all of them. Both the trigger and
the oracle do that, INDEPENDENTLY, and `vc-a2f-override-composition.test.ts` includes a
fixture whose newest-window count is 1 and whose earliest-window count is 3, so a
regression to the look-back form fails.

**Which leg binds in which transaction, and why the trigger alone was not enough.** Count
and hours are fixed at grant, so they bind in the granting transaction. Effects and
monetary are `51 §3.6`'s "consumable quantities" and bind in the dispatching transaction —
registry `I63` names both transactions and one trigger covers them, because it fires on
INSERT and on UPDATE.

The trigger RAISES, which aborts the transaction. That is correct enforcement and a poor
API: a caller cannot distinguish an over-composition from a lost connection without parsing
an error string. So `projectedAggregateBreach` computes the same bound BEFORE the counter
update and the claim returns `REFUSED` with a reason. The trigger stays as the enforcement,
and the composition test exercises it directly on the GRANT path where no application
pre-check exists. Registry `I63`'s enforcement column asks for "DB [...] + RUNTIME", and
this is both rather than either.

---

## 11. `I56`, and making a model classification structurally unable to create a clock

`30 §9.1` makes the clock a lever on the audit plane. Registry `I56`'s test statement is
*"a triage worker classifying every case as a refund request must create **zero** live
clocks"*.

**The structural form was the whole design.** `createStatutoryClock` takes a
`sourceRecordId` and NOTHING that could stand in for one — no `reason`, no
`classification`, no `confidence`, no `rationale`, no `statuteGuess`, no `hasClock`. The id
must resolve to a `retained_source_record` whose only admissible `provenance` is `RECORD`
and whose `kind` is `I56`'s own closed enumeration.

So the negative control's 50 triage outputs — every field a model would want, including
`hasClock: true` and a plausible deadline — have no call to make. They can invent a
`source_record_id`, and it resolves to nothing.

**Two mechanisms, as registry `I56` asks.** The application check gives a legible
`I56_SOURCE_RECORD_DOES_NOT_RESOLVE`; the NOT NULL foreign key gives a constraint
violation on a direct `INSERT`. Each is exercised on its own.

**And `I56` bounds provenance, not volume.** `phase2-v1.3-lower-severity-register.md`
TA-08 schedules the one-live-clock-per-`(case_ref, statute)` rule, the duplicate-content
collapse rule and the per-window anomaly bound as **LATER MVP SLICE (S5)**, with "`I56`'s
schema leg is S1 and is unaffected" in the same row. `§42` forbids inventing them, so
`i56-clock-provenance.test.ts` asserts the CURRENT behaviour — two live clocks on one
`(case_ref, statute)` ARE admitted — and names the deferral, so the residual lives in the
suite rather than only in a document.

---

## 12. A defect found in accepted S1G code

While extending `effect_journal` for the three new row kinds, the immutability trigger was
read closely and found to have a hole.

`0007`'s `effect_journal_immutable_except_mirrored_at` compares an EXPLICIT column list
with `mirrored_at` normalised away. `0008` added `attested_max_journal_seq`,
`attested_row_count` and `attested_head_hash` and did not extend that list. An `UPDATE`
touching only those three passed the outer `(NEW.*) IS DISTINCT FROM (OLD.*)` test,
compared EQUAL on the inner list, and was ALLOWED.

**The attested prefix of a chained journal row was mutable in the control database** — the
rewrite `I41` and `30 §5.5` case 5 exist to make impossible.

**Closed here rather than deferred**, because S1H was about to add eleven more columns to
the same table and would have widened the hole. The repair is not "add three more columns
to the list": the comparison is now over every column with `mirrored_at` removed, so the
guard is total by construction and a future `ALTER TABLE` cannot narrow it by omission.
Strictly more refusing than the accepted trigger — the one permitted update is still
permitted — and `mirror-journal-rows.test.ts` carries the regressions, including one
asserting that `mirrored_at` is still settable so S1G is demonstrably not weakened.

Recorded as `S1H-C4`.

---

## 13. Extending the transport without breaking accepted call sites

The three new row kinds must reach the audit store, because `I17f(b)` is evaluated from
that side and the declaration is one of its operands. `audit_ingest_journal_row` had a
fixed 27-parameter signature, and two ACCEPTED tests call it positionally with 27
arguments.

**Considered and rejected: a second function, `..._v2`.** Two ingest entry points is two
suppression surfaces to reason about, and `A0001`'s whole argument is that there is one.

**Selected: `DROP` then `CREATE` with eleven `DEFAULT NULL` parameters.** A 27-argument
call still resolves to the same function unchanged, so both accepted call sites and their
assertions hold as written. `CREATE OR REPLACE` would not do — a changed signature creates
a second overload and makes a 27-argument call ambiguous. The `GRANT EXECUTE` is re-issued
at the new signature.

---

## 14. Dead ends and corrections during the test build

Recorded because each one was a real error and the correction is the interesting part.

1. **A pairing CHECK that was wrong.** An early draft bound
   `last_attestation_seq = 0` to `last_attestation_received_at IS NULL` on both planes,
   reasoning that "nothing received" means seq 0. It is wrong: `30 §5.4`'s empty attestation
   legitimately reports `max_journal_seq = 0` WITH a real arrival instant. Both CHECKs were
   removed and the nullability given a single meaning — "no attestation has ever been
   received". `S1H-C5`.

2. **A lock-wait observation that observed nothing.** The race test's "the race is a real
   lock" control queried `pg_locks` for an ungranted lock on `degraded_mode_override`. It
   found zero, and the assertion failed. A row-level lock wait appears as an ungranted wait
   on the HOLDER'S `transactionid`, never as an ungranted lock on the relation — both
   backends hold `RowShareLock` on the relation happily. Querying the relation is the
   mistake that would have made the control silently vacuous, so it is now `locktype IN
   ('transactionid', 'tuple')` with the reasoning written beside it.

3. **A trigger-order confusion in an immutability test.** The scope-immutability test set
   `effect_count_cap = 5` on an override whose cap was already 5. A no-op `UPDATE` compares
   EQUAL and passes. Every value in that test now DIFFERS from the granted one, in both
   directions, and the test is retitled: the scope is FIXED AT CREATION, so narrowing is
   refused as well as widening.

4. **An oracle ordinal off by one.** `oracleRequiresSecondApprover` counted only the HELD
   population, while the trigger counts the candidate too — the candidate IS the first,
   second or third override inside its window. The oracle was corrected to `1 + peers`, and
   the roll test's expectation with it.

5. **A CHECK that could not be reached because a BEFORE trigger fired first.** The
   `expires_at = observed_at + max_age` test handed the store non-canonical `signed_bytes`
   and got `AUDIT_SIGNAL_CANONICAL_MISMATCH` — the bind trigger, not the CHECK. The test
   now builds `signed_bytes` with the store's OWN function for exactly those fields, so the
   bind trigger is satisfied and the failure that remains is the CHECK. Two mechanisms, and
   each is shown separately.

6. **Grants that were stricter than the triggers.** Several "the store refuses this"
   assertions expected a trigger message and got `permission denied` — the evaluator holds
   SELECT and INSERT on the signal table and no UPDATE or DELETE at all. That is a STRONGER
   refusal, so each test now asserts BOTH: the grant refuses the real role, and the trigger
   refuses the same operation as the OWNER, so the property does not rest on the grant
   alone.

7. **Four identifiers that collided with accepted source rules, found only by running the
   FULL suite.** Each per-file run passed; the collisions are with source-SCAN tests that
   walk all of `src/`, so only a whole-suite run surfaces them. `rationale` on the decision
   objects collided with `source-rules.test.ts` rule 1 (`26 §2.0` reserves the word for
   model free text); `'CONSUMED'` collided with `26 §12.2`'s approval lifecycle; and
   `'CLAIMED'` — twice, once as the claim outcome and once as the journal event
   `EFFECT_CLAIMED` — collided with `25 §7` layer 4's outbox literal. One further
   collision was a SQL `--` comment containing the word "rationale" in
   `A0002`: `source-rules.test.ts` walks EVERY file under `src/`, not only `.ts`, and its
   comment stripper only handles C-style comments.

   **Renamed rather than exempted, in all four cases.** `explanation`, `SIGNAL_CONSUMED`
   and `ALLOWANCE_TAKEN` (for both the outcome and the event). Amending the accepted
   patterns would have widened four absences the accepted slices established, and the
   S1H concepts are genuinely different concepts — a kernel-authored explanation, a
   consumed corroboration signal, and an allowance taken against a counter with nothing
   claimed externally. Every rename carries the reason at the point of use.

8. **Patterns that matched vocabulary instead of mechanism.** The no-dispatch scan's first
   draft flagged `/\badapter\b/` and hit `26 §5`'s action catalogue, which legitimately
   declares an `adapter` field naming a mock — `37` S1's own scope is "all against a mock
   adapter". Likewise `/\bfetch\s*\(/` hit local `fetch*` helpers that read PostgreSQL, and
   `/\bCLAIMED\b/` hit the override claim's own outcome. Every pattern now names a
   mechanism — an adapter MODULE import, a transport module, an outbox claim — and the
   three legitimate `dispatch`-matching columns are enumerated by name so their presence is
   deliberate.

9. **An accepted test that needed an additive update.**
   `vc-a1d-adversarial-attester.test.ts` asserts the exact set of tables the audit
   evaluator can see, to establish that the audit plane holds no input that could settle the
   `§5.5` case 2b residual. S1H adds two. The list is extended to five with the reasoning
   preserved: both new tables are written by the audit plane's own evaluator from its own
   holdings, neither is an input ABOUT the control journal, and neither settles the
   residual. The property is unchanged.

10. **An accepted absence assertion that S1H legitimately invalidates.**
   `local-authorisation-boundary.test.ts` asserted that the mirror state machine, the
   signal and the override were absent from all of `src/`. S1H builds exactly those three,
   which `37` S1 puts in this slice. The mirror half MOVES to
   `no-dispatch-boundary.test.ts` as CONFINEMENT — the mechanism exists only under four
   named directories — and what STAYS in the accepted file is `I17b`'s external anchor,
   still absent, plus a new and sharper assertion: the pre-R authority path cannot reach the
   mirror at all.

---

## 15. What was deliberately not built, and the citation for each

| Not built | Citation |
|---|---|
| The FULL-HALT POSTURE (all classes halt) | `S1H-C10` — both thresholds undeclared in v1.3.2 |
| `STORE_WRITE_REJECTED` issuance | `S1H-C8` — no declared derivation; quota saturation explicitly forbidden as a mode change |
| The numeric approval-floor derivation | `S1H-C1` — undeclared |
| `I17f(a)` and `I17f(c)` | operands are dispatched effects; `§35` forbids manufacturing them |
| `I8`'s additive verification list | `37` S1: "`I8` proves nothing at S1" |
| TA-08's clock uniqueness / collapse / volume bound | scheduled S5 in the lower-severity register |
| The HTTP endpoint and the provisioned signing key | `30 §5.7.1` Provisioning: "not part of the S1 build" |
| `I19`'s runtime verification of classes 24 and 25 | carried forward with the class-20 residual |
| A separate audit provider or account | `A0001`'s own note; unchanged since S1A |

---

## 16. Files

**Migrations.**

* `src/db/migrations/0009__mirror_state.sql` — three journal row kinds and their declared
  byte orders; the total immutability guard (`S1H-C4`); `retained_source_record` and
  `statutory_clock` (`I56`); `mirror_declaration`, `mirror_corroboration`, `mirror_state`;
  `degraded_mode_override` with `I63(a)`'s CHECKs, `I63(b)`'s aggregate trigger, the
  second-approver trigger, the exhaustion derivation, the monotonic-counter guard and the
  append-only guard; `degraded_mode_override_limits()`; the four journal emitters.
* `src/audit/db/migrations/A0002__mirror_input_stall.sql` — the same three row kinds,
  independently transcribed; `audit_mirror_stall_interval`;
  `audit_mirror_input_stall_signal` with the signed field order, the bytes-binding trigger
  and the append-only guards; `ATTESTATION_DIVERGENCE`; the extended ingest entry point;
  `acos_audit_signal_reader` and its grants.

**Control plane.**

* `src/kernel/mirror/mirrorState.ts` — the three states, `max_age`, the freshness rule, the
  pure resolver.
* `src/kernel/mirror/corroborationSignal.ts` — the signal's declared field order, the
  control-side canonical bytes, and the verifier.
* `src/kernel/mirror/signalSource.ts` — the fetch PORT and its three outcomes.
* `src/kernel/mirror/mirrorStateMachine.ts` — the durable machine.
* `src/kernel/mirror/dispatchPrecedence.ts` — the ordered first-match classifier.
* `src/kernel/mirror/degradedModeOverride.ts` — grant, claim, expire, revoke, and the
  aggregate projection.
* `src/kernel/clocks/statutoryClock.ts` — `I56`.
* `src/replication/corroborationFetch.ts` — the pull adapter.

**Audit plane.**

* `src/audit/mirrorInputStall.ts` — observe, publish, sign, issue.
* `src/audit/attestationDivergence.ts` — `I17f(b)`.

**Extended.**

* `src/audit/transport/journalRecord.ts`, `src/audit/ingress.ts`,
  `src/replication/journalPusher.ts` — the three new kinds on the wire.
* `src/audit/db/auditPool.ts` — the fourth connection identity.
* `src/audit/transportCompleteness.ts` — `ATTESTATION_DIVERGENCE` added to the finding
  union.
