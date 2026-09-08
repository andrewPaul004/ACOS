# S1H — Owner Resolution

The owner's dispositions on `S1H-C1`…`S1H-C12`, the evidence each was checked against, the
architecture package issue three of them required, and the implementation corrections that
issue forced.

**Baseline reviewed:** `b524637` — the S1H PARTIAL candidate.
**Predecessor baseline:** `e47a437` — the accepted S1G candidate.
**Branch:** `feature/s1h-mirror-state-machine`.
**Baseline regression, verified before any edit:** 104 files / 1544 tests / 1544 passed /
0 failed / 0 skipped, `npm run verify` exit 0.
**Architecture package at the start of this pass:** `docs/architecture/v1.3.2/`.
**Architecture package at the end of this pass:** `docs/architecture/v1.3.3/`. **`v1.3.1`
and `v1.3.2` are not modified**; `v1.3.3` is a new immutable package directory carrying four
normative declarations. See `docs/architecture/v1.3.3/phase2-v1.3.3-errata.md`.

**Commits in this pass:**

| Commit | Contents |
|---|---|
| `e5ca7b1` | `docs(arch)`: architecture package issue **v1.3.3** — errata APF-01, MLT-01, FHT-01 and SWR-01, the mechanical gate's ten new conditions G1–G10, and its six seeded negative controls |
| next | `feat(s1h)`: the three missing legs — the derived approval floor, the FULL-HALT POSTURE, `STORE_WRITE_REJECTED`'s closed derivation — with their migrations, negative controls and tests |
| last | `docs(s1h)`: the dispositions, the result, the test matrix and the freeze |

Every disposition below ends in exactly one category, as `§19` requires:

* **DIRECT ARCHITECTURE REQUIREMENT**
* **OWNER CLARIFICATION — ACCEPTED**
* **IMPLEMENTATION DETAIL — NON-SEMANTIC**
* **DEFERRED RESIDUAL**
* **DEFECT FOUND AND REPAIRED**
* **OWNER DECISION STILL REQUIRED**

---

## 0. Summary

| Item | Final classification | Production change |
|---|---|---|
| `S1H-C1` the per-action approval floor has no declared value | **OWNER CLARIFICATION — ACCEPTED.** `51 §3.7` declares **USD 20.00** against `total_exposure`, strict | **YES** — the boolean operand is removed; the predicate is derived |
| `S1H-C2` `30 §5.6`'s three entry conditions are not disjoint | **OWNER CLARIFICATION — ACCEPTED, CONSERVATIVE PARTITION** | none — authority-equivalent, proven over the cross-product |
| `S1H-C3` `I63(b)`'s "all records" includes revoked and expired | **DIRECT ARCHITECTURE REQUIREMENT** | none |
| `S1H-C4` the S1G journal-immutability guard had a hole | **DEFECT FOUND AND REPAIRED; OWNER ACCEPTED SUBJECT TO REGRESSION** | already in `b524637`; regression re-verified |
| `S1H-C5` `last_attestation_received_at`'s nullability | **IMPLEMENTATION DETAIL — NON-SEMANTIC** | none |
| `S1H-C6` a future-dated signal is refused | **OWNER CLARIFICATION — ACCEPTED** (strictly stricter) | none |
| `S1H-C7` "rows 3 or 5" is imprecise; "never row 2" is operative | **OWNER CLARIFICATION — ACCEPTED** | none |
| `S1H-C8` `STORE_WRITE_REJECTED` has no declared derivation | **OWNER CLARIFICATION — ACCEPTED.** `30 §5.7.1a` declares a closed ten-condition audit-owned derivation | **YES** — `A0003`, `A0004`, the classifier, the derivation |
| `S1H-C9` the byte order for the three new row kinds | **IMPLEMENTATION DETAIL — NON-SEMANTIC** | none |
| `S1H-C10` the mirror-lag and full-halt thresholds are undeclared | **OWNER CLARIFICATION — ACCEPTED.** `51 §3.8` declares **PT15M** and **PT30M**, both inclusive | **YES** — the posture, the lag condition, both operands |
| `S1H-C11` whether an override applies in `NORMAL` / `CORROBORATED_DEGRADED` | **OWNER CLARIFICATION — ACCEPTED**, and `30 §5.1a` resolves its posture leg | none; the item-5/`I17f(a)` tension stays a **DEFERRED RESIDUAL** |
| `S1H-C12` `I8`'s additive verification list cannot be populated at S1 | **DEFERRED RESIDUAL** — the architecture itself defers it | none |

**`OWNER DECISION STILL REQUIRED`: ZERO.** `§19`'s expected count. No new load-bearing
ambiguity appeared, and `§16`'s and `§3`'s two STOP conditions were both checked and both
found not to trigger — `§7` below records exactly what the architecture says in each case.

---

## 1. `S1H-C1` — the per-action approval floor

### `OWNER CLARIFICATION — ACCEPTED` — resolved normatively by **v1.3.3, erratum APF-01**

### The gap, restated exactly

`30 §5.1` item 4 row 2 is *"Above the per-action approval floor **and not** clock-bearing →
Halt"*. Three artifacts referred to the quantity and **none declared it**: `50 §2` class 3
listed *"approval floor"* as a signed catalogue **field with no value**; `26 §12`'s tier
table gives `NONE | TIER_1 | TIER_2 | OWNER` against triggers in words and no monetary
thresholds at all; `51` declared no row. And `30 §5.1`'s own AUD-05 narrative, `22 §3.1` and
`36`'s `VC-A6` each stated the floor in prose as `$25` — the same figure as
`refund.create`'s `per_action_max`.

S1H implemented the row-2 BEHAVIOUR over both values of the predicate and took the predicate
as a caller-supplied boolean, reporting the DERIVATION PARTIAL. That was the correct refusal
under `§42`, and it left an authority escape hatch: a caller passing `false` skipped row 2.

### The owner decision

> **`degraded_per_action_approval_floor_monetary` = USD 20.00.**
>
> Operand: **`effect.request.exposure.total_exposure`** — not `vendor_amount`, not a dispatch
> amount, not a model amount, not a `rationale` figure, not grant prose.
>
> **Strict:** `total_exposure > 20.00` is ABOVE. `$20.00` is not; `$20.01` is.
>
> A degraded-mode dispatch-precedence approval floor. Not `per_action_max`, not a Cedar DENY
> ceiling, not MAL, not a window ceiling, not a reservation amount, not an override cap.

Declared in `51 §3.7`, specified in `30 §5.1a`, provenance `OWNER DECISION / v1.3.3`.

### Why the two bounds cannot be one number

`51 §3.1` gives `refund.create` a `per_action_max` of `$25.00` and `26 §8` makes it a **DENY**
boundary. **A denied effect never reaches item 4's precedence list at all**, so
`per_action_max` cannot be row 2's operand. And at a floor equal to it the band in which
row 2 is reachable would be **EMPTY** — row 2 would be dead code presenting as a live
control for the whole S1 catalogue. `$20.00` leaves the band `$20.01 … $25.00`.

`30 §5.1a` prints the band across `$19.99 … $25.01`, and gate condition **G3** is a denylist
over every line of the operational corpus that forbids any operational passage from equating
the two, exempt only where a line explicitly records the conflation as v1.1's defect.

### Production change — THE ESCAPE HATCH IS REMOVED, NOT RENAMED

`§13`: *"The model/caller must not choose `aboveApprovalFloor`. [...] remove or internalize
that authority escape hatch."*

| Before (`b524637`) | After |
|---|---|
| `PrecedenceOperands.aboveApprovalFloor: boolean` | **gone.** `PrecedenceOperands.totalExposure: Money` |
| the predicate was the caller's | derived by `isAboveDegradedApprovalFloor`, the one comparison site in `src/` |
| the quantity existed nowhere | `DEGRADED_PER_ACTION_APPROVAL_FLOOR`, `src/kernel/mirror/degradedModeThresholds.ts`, transcribed from `51 §3.7` |

**No TEST-ONLY seam re-admits it.** `§13` permits one and this implementation does not use
one: the truth table is exercised over both values of the predicate by choosing exposures
either side of the declared floor, which is strictly stronger because it also proves the
derivation. `dispatch-precedence-approval-floor.test.ts` asserts the absence of a seam as a
source property, over executable lines, and asserts that `vendorAmount`, `vendor_amount`,
`dispatchAmount` and `rationale` appear in no executable line of the classifier.

### The regression proof

`§13`: *"Assert that S1H's existing hand-authored expected table still stands."*

It does, and the assertion is explicit. `tests/support/mirrorPrecedenceTable.ts` — which
imports nothing — now carries `total_exposure` as a decimal literal in `OracleCase` and
derives the above-floor predicate from its own hand-transcribed `2000n`.
`expectedFor`'s row-by-row logic is otherwise **byte-identical**, and both
`vc-a2-inversion.test.ts` and `dispatch-precedence-approval-floor.test.ts` run the full
72-row cross-product against it. The second file additionally counts the rows that reach
row 2 and fails if none does, so the derivation cannot pass vacuously.

### Control-artifact effect

The floor is a field of **class 3**, which already enumerated it. Giving it a value moves
class 3's `content_hash` and a fresh owner signature with a second factor is owed. **No new
class was created for it** — `§11` forbids a duplicate — and **no production owner-signing
or runtime `I19` mechanism exists**, so nothing claims the signature is discharged.

### Authority effect

**None.** `MAL_monetary(month)` = `$300.00`, `MAL_total(month)` at the signature basis =
`$756.00`, `per_action_max` = `$25.00`, `recompute-v1.3.py` reproduces its recorded output
line for line. The floor gates *dispatch*, never *exposure*.

---

## 2. `S1H-C2` — `30 §5.6`'s three entry conditions

### `OWNER CLARIFICATION — ACCEPTED, CONSERVATIVE PARTITION`

`§17` asks whether the stricter partition is **authority-equivalent for every precedence
outcome**, and requires a counterexample-and-stop if any observable authority outcome
differs.

### The two readings

Read as three independent predicates, *"mirror acknowledging AND a valid signal held"*
satisfies both row 1 (`NORMAL`) and row 3 (`CORROBORATED_DEGRADED`), and the table declares
no precedence. S1H selected the partition in which the mirror observation is the OUTER
discriminator:

```
acknowledging                      → NORMAL
unreachable, no fresh valid signal → UNCORROBORATED_STALL
unreachable, fresh valid signal    → CORROBORATED_DEGRADED
```

### Authority-equivalence, checked rather than asserted

**The contested combination is "no declaration open AND a fresh valid signal held".** The
stricter reading resolves it to `NORMAL`; the permissive reading resolves it to
`CORROBORATED_DEGRADED`. `36 §6` makes `CORROBORATED_DEGRADED` *"as `NORMAL`, with every
dispatch tagged"*, so the two readings differ in **exactly one** output field —
`requiresUnmirroredTag` — and in **no** disposition and **no** matched row.

`vc-a2-inversion.test.ts` asserts that directly, over all 24 operand combinations:
`CORROBORATED_DEGRADED`'s dispositions and matched rows are IDENTICAL to `NORMAL`'s. So the
question `§17` asks is answered by an existing suite over the whole cross-product rather than
by argument:

**Does any observable authority outcome differ between the two readings? NO.**
The disposition is identical for all 24; the matched row is identical for all 24; the tag
differs, and a tag is not authority — it is `I17f`'s subject.

**And v1.3.3 does not broaden it.** `30 §5.1a`'s closing paragraph states that `§5.6`'s three
entry conditions are unchanged by the pass, and gate condition **G5** requires the mirror-lag
condition to be incapable of creating `CORROBORATED_DEGRADED`.

**The residual is unchanged and still reported.** Under this reading a control plane holding
a fresh valid signal while declaring nothing resolves to `NORMAL`, and a row-3 dispatch there
would carry no tag; if the audit plane published a covering interval that is an `I17f(c)`
exposure whose only detector is `I8`. `resolveMirrorState` reports it as the
`SIGNAL_HELD_WITHOUT_DECLARATION` anomaly and
`i17f-attestation-divergence.test.ts` case C exercises it. **Access is not broadened**: the
anomaly changes no disposition.

---

## 3. `S1H-C3` — `I63(b)`'s "all records"

### `DIRECT ARCHITECTURE REQUIREMENT`

Registry `I63(b)` says *"all `DegradedModeOverride` records"* and `30 §5.7.2`'s status set
includes `REVOKED` and `EXPIRED` with nothing exempting either. The implementation counts
every record whatever its status, and `degraded_mode_override` is append-only so a record
cannot leave the population. Unchanged by v1.3.3; `vc-a2f-override-composition.test.ts` and
its unbounded control still assert it.

---

## 4. `S1H-C4` — the S1G journal-immutability hole

### `DEFECT FOUND AND REPAIRED; OWNER ACCEPTED SUBJECT TO REGRESSION`

`§18` accepts the repair and requires four things verified. Each is verified and none is
reverted, because `§18` also says: *"Do not revert it merely because it modifies accepted S1G
code."*

| `§18` requirement | Verified |
|---|---|
| the affected attestation fields are now immutable | `mirror-journal-rows.test.ts` `S1H-C4` case 1 — `attested_row_count`, `attested_head_hash` and `attested_max_journal_seq` each rejected with `JOURNAL_ROW_IMMUTABLE` |
| `mirrored_at` remains the only permitted narrow mutation | same file, case 3 — the `UPDATE` succeeds and affects exactly 1 row. `30 §5.2` requires it to be settable "on first successful acknowledgement" |
| direct PostgreSQL UPDATE attacks fail | every assertion above is a raw `UPDATE` issued on a real control connection, not a call through a repository. `DELETE` is refused with `APPEND_ONLY_TABLE_effect_journal` |
| S1G chain / `VC-A3` / attestation tests remain green | `vc-a3-cross-implementation.test.ts`, `post-commit-and-crash-matrix.test.ts` and the attestation suites are green in this pass's `npm run verify`, and v1.3.3 changed none of them |

**The defect, restated.** `0007`'s `effect_journal_immutable_except_mirrored_at` compared an
EXPLICIT column list with `mirrored_at` normalised away. `0008` added three attestation
columns and did not extend that list, so an `UPDATE` touching only those three passed the
outer `(NEW.*) IS DISTINCT FROM (OLD.*)` test and compared EQUAL on the inner list. **The
attested prefix of a chained journal row was mutable in the control database** — the rewrite
`I41` and `30 §5.5` case 5 exist to make impossible. `0009` replaces the comparison with
`to_jsonb(NEW) - 'mirrored_at'`, so the guard is total by construction and a future
`ALTER TABLE` cannot narrow it by omission.

**Strictly more refusing than the accepted trigger.** The one permitted update is still
permitted; every previously refused update is still refused. v1.3.3 adds no column to
`effect_journal`, so the repair is unaffected by this pass.

---

## 5. `S1H-C5`, `S1H-C6`, `S1H-C7`, `S1H-C9` — the four readings and declarations

### `S1H-C5` — `last_attestation_received_at` is NULLABLE. `IMPLEMENTATION DETAIL — NON-SEMANTIC`

`30 §5.7.1` prints the signal without nullability markers and a stall declared before a
company's first attestation has no instant to report. NULL means exactly one thing: no
attestation has ever been received. The alternative — a fabricated timestamp inside a SIGNED
artifact — is worse. **Not paired with `last_attestation_seq = 0`**, because `30 §5.4`'s empty
attestation legitimately reports `max_journal_seq = 0` WITH a real arrival instant. Unchanged
by v1.3.3.

### `S1H-C6` — a future-dated signal is REFUSED. `OWNER CLARIFICATION — ACCEPTED`

`30 §5.7.1`'s conjunction admits `observed_at > now`: the first conjunct's left side is
negative, which satisfies `≤ max_age`. `isCorroborationFresh` refuses it and
`verifyCorroborationSignal` reports `SIGNAL_FUTURE_DATED`. **No tolerance quantity is
introduced** — a REFUSAL is added, and a refusal cannot unlock authority, so it cannot move
any row of `VC-A2`'s inversion table in the permissive direction. Accepted as recorded.

### `S1H-C7` — "never row 2" is the operative half. `OWNER CLARIFICATION — ACCEPTED`

`30 §5.1` item 4's *"Approval-bearing effects evaluate at rows 3 or 5 once approved"* is not
exhaustive: an above-floor, APPROVED, COMPENSABLE, DISCRETIONARY effect cannot reach row 3
because row 3 requires a live clock, so it falls to row 4 and suspends.
`phase2-v1.2-remediation-ledger.md` states the applied change in its operative form — *"never
row 2"* — and that is what row 2's predicate encodes. **Now asserted at the declared floor
too**: `dispatch-precedence-approval-floor.test.ts` runs an above-floor approved effect and
asserts row 4, and `first-match-order.test.ts` keeps its accepted row-4 assertion.

### `S1H-C9` — the three new byte orders. `IMPLEMENTATION DETAIL — NON-SEMANTIC`

`30 §5.3` requires the order to be declared per row kind in the specification and none of
`§5.7`'s passages declares one. The orders are declared in `S1H-contract.md §4` and
transcribed independently on the control server (`0009`), on the audit server (`A0002`) and a
fourth time by hand in `tests/support/jcs1Oracle.ts`, which is the judge. **v1.3.3 adds no
journal row kind and no journal column**, so no order moved and `mirror-journal-rows.test.ts`
is unchanged.

---

## 6. `S1H-C8` — `STORE_WRITE_REJECTED`'s derivation

### `OWNER CLARIFICATION — ACCEPTED` — resolved normatively by **v1.3.3, erratum SWR-01**

### The gap, restated exactly

`30 §5.7.1` declared the enum member and no derivation. The one candidate reading — insert
quota saturation — is **explicitly forbidden as a mode change** by `§5.1` item 5 and by
`§5.6`'s reachability table. So the member was either dead or a route by which a REFUSAL
became the architecture's only dispatch RELAXATION, arriving through the audit plane's own
enum. S1H never returned it and reported the leg PARTIAL.

### The owner decision — a closed ten-condition AUDIT-OWNED predicate

`30 §5.7.1a` declares it. All ten conjuncts of one replication attempt: it reached audit
ingress; identity and authentication succeeded; the record is admissible; `ACOS-JCS-1`
reconstruction succeeded; every pre-storage transmitted/canonical/row-hash check succeeded;
not a conflicting collision; not an exact benign duplicate; quota available; the store write
was attempted; and it could not commit because of a store-write availability failure.

**Conditions 1–8 are the conditions under which the store would otherwise have ACCEPTED the
row**, so the member names exactly one situation.

### The semantic class, and where the vendor mapping lives

`§6`: *"Do not make the architecture depend on a giant vendor-specific SQLSTATE list. The
architecture declares the SEMANTIC failure class. The PostgreSQL implementation declares
which concrete failures map into it."*

| Layer | Declares |
|---|---|
| `30 §5.7.1a` | `AUDIT_STORE_WRITE_UNAVAILABLE` — the genuine inability of an otherwise healthy, authenticated ingress path to make a **valid** write durable because the audit storage layer is unavailable for writes. Plus the requirement that the concrete mapping be closed, documented, tested and fail-closed |
| `src/audit/storeWriteAvailability.ts` | **three SQLSTATEs**, each with its justification, and an allowlist so everything else is `UNKNOWN` |
| `A0004`'s exception handler | the same three, transcribed independently inside the audit store under `acos_audit_owner` |

**The three, and why each is store availability rather than security, integrity or policy:**

| Code | PostgreSQL | Why it is store availability |
|---|---|---|
| `53100` | `disk_full` | the relation or WAL cannot be extended. The row is valid and the same bytes succeed the moment space exists; it says nothing about the writer and contradicts no held predecessor. **It is not the insert quota** — `I17c`'s quota is a declared accounting limit that returns an OUTCOME and never reaches this handler |
| `58030` | `io_error` | the storage layer failed the physical write. A failure to make a valid write durable, which is the class exactly. Deliberately narrow: `58P01` (`undefined_file`) is EXCLUDED, because a missing file is a claim about the store's own state that this reading would launder into a mode change |
| `25006` | `read_only_sql_transaction` | the instance will not accept writes at all — in recovery, hot standby, or `default_transaction_read_only`. **Not a privilege failure:** a privilege failure is about the PRINCIPAL and raises `42501`, which is excluded; `25006` is about the INSTANCE and is raised identically for a superuser |

**Twenty-one codes are excluded by name** in `EXPLICITLY_EXCLUDED_SQLSTATES`, one per
member of `§5.7.1a`'s exclusion list, and the suite asserts every one classifies `UNKNOWN`.
The list is illustrative of the reasoning; **the mechanism is the allowlist**, so a code
nobody enumerated is refused by construction.

### Why the conjunct ORDERING is a property of the code rather than a checklist

`A0001`'s ingest function already establishes conditions 1–8 before the heap write, and
**six of the eight disqualifying conditions leave the function through a `RETURN` rather than
through an exception**. The trigger performing conditions 4, 5 and 8 —
`audit_journal_chain` — is `BEFORE INSERT`, so it has already run when the heap write is
attempted. An error reaching the new handler arrived after all of them.

**That ordering is asserted against real PostgreSQL rather than argued.**
`store-write-availability.test.ts` installs the store-write failure AND a malformed row
together and finds `AUDIT_CANONICAL_MISMATCH` with zero observations; it installs the
failure AND a saturated quota together and finds `AUDIT_QUOTA_SATURATED` with zero
observations.

### The observation is durable, audit-owned and append-only

`A0003` creates `audit_store_write_failure`. The control plane holds nothing on it — the
suite attempts SELECT, INSERT, UPDATE, DELETE and the recorder's EXECUTE as the real
`acos_audit_replication` role and every one is refused, and the corroboration FETCH
credential is refused too. `UPDATE` and `DELETE` are refused for everyone with
`APPEND_ONLY_TABLE_audit_store_write_failure`, because `§5.7.1a` makes this the derivation's
only operand and a deletable row would be a deletable corroboration basis. The recorder
refuses any `failure_class` but the declared one.

### The five controls `§8` requires

| Case | Unsafe | Production | Mode change? | Discriminates? |
|---|---|---|---|---|
| **A** quota saturation | `unsafeOutcomeMapper` → `AUDIT_STORE_WRITE_UNAVAILABLE` | `AUDIT_QUOTA_SATURATED` outcome, `I17c` incident, **zero observations**, `observeStall` never reports the cause | **NO** | **YES** |
| **B** sequence collision | same mapper → the class | `AUDIT_SEQUENCE_COLLISION` at CRITICAL, zero observations | **NO** | **YES** |
| **C** canonical / hash mismatch | same mapper → the class | `AUDIT_CANONICAL_MISMATCH`, zero observations — **and still so with the storage failure injected simultaneously** | **NO** | **YES** |
| **D** unknown database error | `unsafeErrorMapper` and `unsafeOpenEndedSqlstateMapper` → the class | propagates; `classifyStoreWriteError` → `UNKNOWN`; zero observations | **NO** | **YES** |
| **E** genuine availability failure | — | **`AUDIT_STORE_WRITE_UNAVAILABLE`** outcome, an audit-owned observation, a CRITICAL incident, and `observeStall` **DOES** derive `STORE_WRITE_REJECTED` | yes, as declared | **positive control** |

E is what makes A–D non-vacuous: without it the four would be satisfied by "never emit it",
which is exactly what `b524637` shipped.

### Which reason wins when both conditions hold

A store-write failure that persists also stops attestations, so after `k × cadence` both
conditions hold and v1.3.3 declares no precedence between `reason` values. **None is needed,
because `reason` is not an authority operand**: `resolveMirrorState` never reads it,
`corroborationSignal.ts` checks only closed-enum membership, and `§5.7.1a` says a
`STORE_WRITE_REJECTED` signal *"confers exactly what `ATTESTATION_STALL` confers and nothing
more"*. `observeStall` reports the more specific observation — the store-write failure is a
mechanism the audit plane observed directly, where the attestation stall is an inference from
an absence. **Recorded as `IMPLEMENTATION DETAIL — NON-SEMANTIC` within this item**, because
it is authority-neutral by construction rather than by choice.

### The honest narrowness

The audit plane must write its own interval and signal rows to publish anything, so the
derivation is reachable only where the storage layer is unavailable for the **journal
holdings** while the audit plane's own tables remain writable — a per-tablespace or
per-relation failure. Where the whole store is unavailable, nothing is published and the
answer is `UNCORROBORATED_STALL` plus the override. `30 §5.6`'s reachability table gains a
row for each case, and this is stated where it is built (`A0003`'s header) as well as in the
architecture.

### Control-artifact effect

**None.** The derivation is audit-plane logic, not a control artifact; the audit signing key
remains class 24, unchanged. The concrete mapping is implementation-side and is covered by
`VC-A2h` and by review.

---

## 7. `S1H-C10` — the two timing thresholds and the FULL-HALT POSTURE

### `OWNER CLARIFICATION — ACCEPTED` — resolved normatively by **v1.3.3, errata MLT-01 and FHT-01**

### The gap, restated exactly

`30 §5.1` item 5 declares two behaviours against two undeclared thresholds, and the second
had no declared operand and **no declared timer semantics**, so *"unreachable beyond"* could
not be evaluated even given a number. `24 §3` K11 and `35 §12.1` repeat both in the same
words. The consequence was that the FULL-HALT POSTURE — a fourth behaviour outside the three
states — was **not implemented at all**.

### The owner decisions

> **`mirror_lag_critical_threshold` = 15 minutes (`PT15M`).** `mirror_lag >= PT15M` is at or
> over the threshold. Operand: `now() − min(occurred_at)` over the company's `effect_journal`
> rows whose `mirrored_at` is null, on the control database clock.
>
> **`audit_unreachable_full_halt_threshold` = 30 minutes (`PT30M`).**
> `continuous_unreachability >= PT30M` enters the FULL-HALT POSTURE. Operand:
> `now() − opened_at` of the company's OPEN `AUDIT_MIRROR_DEGRADED` declaration, and `0` when
> none is open.

Both declared in `51 §3.8`, both specified in `30 §5.1a`, both `OWNER DECISION / v1.3.3`.

### `§3`'s STOP CONDITION — CHECKED, AND IT DOES NOT TRIGGER

`§3`: *"If the current architecture does not define how the timer starts/resets, STOP and
report that as a new normative gap rather than inventing reset semantics."*

**The architecture defines it, and the definition is the schema's.** `30 §5.7` already
requires the control-side declaration to be an `AUDIT_MIRROR_DEGRADED` **journal row**, and
`§5.7.1` already requires the interval to be recorded; `0009`'s `mirror_declaration` carries
`opened_at NOT NULL`, `closed_at`, `mirror_declaration_closes_after_opening` and — the
load-bearing one — `mirror_declaration_one_open_per_company`. So *"continuous unreachability"*
has exactly one reading and there is **nothing to reset**: the timer is a subtraction over a
durable instant that already existed.

Every case `30 §5.1a` lists as NOT resetting the timer is a case that leaves `opened_at`
alone, and `full-halt-posture.test.ts` drives each against real PostgreSQL:

| Event | `opened_at` after |
|---|---|
| a repeated `declareMirrorDegraded` | unchanged — the existing declaration is returned, and a second is impossible |
| a corroboration written / consumed | unchanged — `mirror_corroboration` has no `opened_at` column, asserted from `information_schema` |
| a fresh `evaluateState` at any later instant | unchanged, at three separate instants including 100 hours later |
| a restart of either plane | unchanged — no process-local state exists; the operand is read from PostgreSQL on every call |
| **`closeMirrorDeclaration`** | **this is the reset**, and afterwards the operand is `null` and the posture cannot hold |
| a NEW declaration after a close | a NEW interval, one millisecond old, not a continuation |

`§3` also says *"Do not infer elapsed time from model input."* The operand is
`mirror_declaration.opened_at` written by the declaration path and `now` read from the control
database clock (`36 §6`). There is no argument through which a model could supply, advance or
reset either.

### `§16`'s STOP CONDITION — CHECKED, AND IT DOES NOT TRIGGER

`§16`: *"If current architecture does not state whether the already-built override may escape
the prolonged-unreachability full halt: STOP and report that specific conflict. Do not
assume."*

**The architecture states it, in two adjacent sentences of item 5, and their composition is
determinate rather than assumed:**

1. *"The only escape from **either the halt** or `UNCORROBORATED_STALL`'s row-3 suspension is
   a `DegradedModeOverride`"* — "either the halt" is the prolonged-unreachability halt named
   in the sentence immediately before it, so **the override does reach the full halt**; and
2. one sentence later, *"An override restores precedence rows **3 and 4 only**, never rows 1
   or 2"*, with `51 §3.6` making `{3, 4}` the structural grantable set.

**Composed: in the posture, rows 3 and 4 are restorable by an in-scope override; rows 1, 2 and
5 are not.** Row 5's REVERSIBLE dispatch — which the posture is what halts — has **no**
override path, because `precedence_rows` cannot hold `5`. Nothing was assumed and no
quantity was invented; `30 §5.1a` records the composition, `I63`'s operand block records it,
and `full-halt-posture.test.ts` asserts every leg of it, including that an override naming
row 5 **cannot be granted at all** against real PostgreSQL.

**No override quantity moved.** 24 h, 5 effects, $50.00 per override; 3 / 72 h / 8 / $100.00
per rolling 30 days; the second-approver rule from the 2nd override. `§16`'s list, unchanged,
and `degraded-mode-thresholds.test.ts` asserts that neither threshold is any override
quantity.

### The relationship to attestation — ALIGNED, NOT MERGED

`§4`: *"The 15-minute selection is aligned with the accepted JournalAttestation cadence = 5
minutes, k = 3 [...] Do NOT merge the concepts."*

`degraded-mode-thresholds.test.ts` asserts the alignment against `ATTESTATION_STALL_BOUND_MS`
— S1G's **accepted** transcription of `cadence × k`, which this pass did not write — and then
asserts the non-merger: `max_age` (5 minutes) is a different quantity and is strictly less;
neither threshold is an override quantity; and `PT30M > PT15M` is arithmetic on the two
declared constants. **A timer alone does not create `CORROBORATED_DEGRADED`**:
`mirror-lag-critical.test.ts` drives a lag ten times the threshold and asserts, over the
durable tables, that the state stays `NORMAL`, `mirror_corroboration` stays empty,
`degraded_mode_override` stays empty and every window ceiling is byte-identical.

### Production change

| Leg | Built |
|---|---|
| the two quantities | `DEGRADED_MODE_TIMING`, transcribed from `51 §3.8`; `classifyMirrorLag`; `isFullHaltPosture` |
| the `mirror_lag` operand | `mirrorLagMsOn` / `mirrorLagMs` / `mirrorLagCondition` |
| the `continuous_unreachability` operand | `openDeclarationOpenedAt`, and `mirrorDispatchOperands` which reads the state and the instant in ONE transaction so a caller cannot assemble an incoherent pair |
| the posture | `classifyDispatchPrecedence` evaluates item 4's ordered list, then reduces every disposition to `HALT` unless an in-scope override restored rows 3 or 4 |
| the coherence guard | `mirrorState !== 'NORMAL'` with a null instant, and its converse, **throw** — a `null` accepted alongside a degraded state would be the escape hatch APF-01 removed |

**The posture is a REDUCTION over the disposition, applied after the row is decided.** So
`matchedRow` still reports item 4's own answer — `VC-A2g` needs to distinguish a REVERSIBLE
effect halted at ROW 5 UNDER THE POSTURE from one halted at row 1 — and the reduction cannot
make anything more permissive, which `full-halt-posture.test.ts` asserts over `PERMISSIVENESS`
for every class.

**And `haltedByFullHaltPosture` attributes the halt honestly**: rows 1 and 2 halt on their own
merits in or out of the posture, so it is `false` for them and `true` only for the rows the
posture actually reduced.

### `§14`'s required vulnerable control

`unsafe-prolonged-unreachability.ts` is the ordinary three-state table evaluated for ever,
with row predicates transcribed identically to production's. **It is what `b524637`
shipped**, not a straw man. At `30:00.000` it marks REVERSIBLE `DISPATCH_ELIGIBLE` at row 5
and reports `futureDispatchEligible: true`; production HALTs every class. The suite asserts
that the two **AGREE at 29:59.999**, so the discrimination is attributable to the posture and
to nothing else, and that production is the stricter of the two wherever they differ.

---

## 8. `S1H-C11` — the override's scope in `NORMAL` and `CORROBORATED_DEGRADED`

### `OWNER CLARIFICATION — ACCEPTED`, with one `DEFERRED RESIDUAL` unchanged

`30 §5.1` item 5's scope rule is stated over ROWS, not over states, and row 4 suspends in all
three states, so an override scoped to row 4 has something to restore in `NORMAL` too. The
implementation applies the override to rows 3 and 4 whenever it is `ACTIVE`, in-window and in
scope, in ANY state, and tags every override dispatch in any state because item 5 says so
without qualification.

**v1.3.3 resolves its posture leg and nothing else.** `30 §5.1a` states which rows the
override reaches inside the posture; it does not touch which states it applies in.

**The residual stays a `DEFERRED RESIDUAL`, reported rather than resolved.** In
`UNCORROBORATED_STALL` no published stall interval is KNOWN to exist, so an override dispatch
tagged `DISPATCHED_UNMIRRORED` there could violate `I17f(a)`, which requires a concurrent
audit-published interval covering the dispatch timestamp. Item 5 is unqualified, so it is
implemented as written. **Not reachable at S1H, because nothing is dispatched and nothing is
tagged**, and carried forward in `S1H-result.md §16`.

---

## 9. `S1H-C12` — `I8`'s additive verification list

### `DEFERRED RESIDUAL` — the architecture itself defers it

`36 §9` VC-A2e requires asserting that every dispatch under an override appears in the next
`I8` verification list. `37` S1 answers it: *"`I8` proves nothing at S1. All four action
classes run against mock adapters, so there is no vendor side for the inverse sweep to
enumerate."* Not implemented and not simulated. `no-dispatch-boundary.test.ts` asserts the
absence of any vendor read, sweep or adapter in `src/`, so the OPEN status cannot drift into a
silent claim. Unchanged by v1.3.3.

---

## 10. What this pass deliberately did not do

* **It did not modify `docs/architecture/v1.3.2/` or `v1.3.1/`.** Both are byte-identical:
  `git diff --stat` reports zero changed files and the index hashes are unchanged.
* **It did not rewrite `b524637`.** Three commits sit on top of it.
* **It did not redesign the precedence classifier.** Five rows, same order, same predicates
  except row 2's operand, which became the declared one.
* **It did not redesign the state machine.** Three states, three entry conditions, one
  resolver, unchanged.
* **It did not redesign the override.** Every `51 §3.6` quantity unchanged; no grantable set
  widened; no ceiling reachable.
* **It did not touch `ACOS-JCS-1`.** No journal row kind, no journal column, no byte order
  moved. Class 20's residual is carried, not discharged.
* **It did not implement S1I.** No outbox, no exclusive external claim, no `I36`, no vendor
  idempotency, no adapter, no HTTP or vendor execution, no reconciliation, no settlement, no
  approval resume, no standing-revocation execution, no AI.
* **It did not claim a signing or `I19` mechanism exists.** Two signatures are newly owed —
  class 3 and the new class 27 — and both are recorded as owed alongside class 20's.
