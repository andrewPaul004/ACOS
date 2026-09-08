# S1H — Owner Clarifications

Every place S1H had to read v1.3.2 and found it silent, ambiguous, or in need of an
implementation declaration. Each item states what the architecture says, what was
implemented, and whether an owner decision is required.

**Disposition legend.** `ARCHITECTURE ABSENT` — the architecture declares no value and
`§42` of the S1H mandate forbids inventing one; the affected leg is reported PARTIAL.
`READING SELECTED` — two readings were available and the stricter one was taken.
`IMPLEMENTATION DECLARATION` — the architecture mandates the obligation but not the
representation, so S1H declares it and the declaration is the specification.
`ADDITION` — a refusal S1H adds beyond the declared rule, which cannot unlock authority.
`DEFECT FOUND` — a defect in accepted code, closed here.

---

## OWNER RESOLUTION — every item dispositioned. `OWNER DECISION STILL REQUIRED`: **ZERO**

The owner resolved all twelve under **architecture package issue v1.3.3**. Each item below
carries an `OWNER RESOLUTION` block stating its final classification; the full record, the
evidence, and the two STOP conditions that were checked and found not to trigger are in
`S1H-owner-resolution.md`.

| Item | Final classification |
|---|---|
| `S1H-C1` | **OWNER CLARIFICATION — ACCEPTED.** `51 §3.7`: **USD 20.00** against `total_exposure`, strict |
| `S1H-C2` | **OWNER CLARIFICATION — ACCEPTED, CONSERVATIVE PARTITION** |
| `S1H-C3` | **DIRECT ARCHITECTURE REQUIREMENT** |
| `S1H-C4` | **DEFECT FOUND AND REPAIRED; OWNER ACCEPTED SUBJECT TO REGRESSION** |
| `S1H-C5` | **IMPLEMENTATION DETAIL — NON-SEMANTIC** |
| `S1H-C6` | **OWNER CLARIFICATION — ACCEPTED** |
| `S1H-C7` | **OWNER CLARIFICATION — ACCEPTED** |
| `S1H-C8` | **OWNER CLARIFICATION — ACCEPTED.** `30 §5.7.1a`: a closed ten-condition audit-owned derivation |
| `S1H-C9` | **IMPLEMENTATION DETAIL — NON-SEMANTIC** |
| `S1H-C10` | **OWNER CLARIFICATION — ACCEPTED.** `51 §3.8`: **PT15M** and **PT30M**, both inclusive |
| `S1H-C11` | **OWNER CLARIFICATION — ACCEPTED**; the item-5 / `I17f(a)` tension stays a **DEFERRED RESIDUAL** |
| `S1H-C12` | **DEFERRED RESIDUAL** |

**The text of each item below is unchanged from `b524637`**, so the question as it was asked
is still readable beside the answer.

---

## S1H-C1 — the per-action approval floor has no declared numeric value

**Disposition: ARCHITECTURE ABSENT. Owner decision required.**

`30 §5.1` item 4 row 2 is *"Above the per-action approval floor **and not**
clock-bearing → **Halt**"*. `50 §2` class 3 lists "approval floor" as a field of the
owner-signed action catalogue. `30 §5.1`'s rationale and `22 §3.1` both refer in prose to
*"the $25 per-action approval floor"*.

**No numeric `approval_floor` quantity is declared anywhere in v1.3.2.** What is declared:

- `51 §3.1` gives `refund.create` a `per_action_max` of **$25.00**, which is a DENY
  boundary — `26 §8`: `context.exposure.total_exposure <= 25.00`, and an effect above it
  *"denies `PER_ACTION`"*. An effect that denies never reaches dispatch precedence at all,
  so `per_action_max` cannot be row 2's operand.
- `26 §12`'s tier table gives `NONE | TIER_1 | TIER_2 | OWNER` against *"typical
  triggers"* in words — *"Exposure above the autonomous floor but below material"* — and
  no monetary thresholds.
- `26 §5`'s catalogue schema carries `approval_requirement NONE | TIER_1 | TIER_2 | OWNER`
  per class, which is a tier and not a floor.

**Implemented.** `classifyDispatchPrecedence` takes `aboveApprovalFloor: boolean` as a
DECLARED AUTHORITATIVE OPERAND, supplied by `26 §12`'s approval machinery, which `37` S5
builds. The row-2 BEHAVIOUR is fully implemented and tested over both values of the
boolean and in all three mirror states; what is PARTIAL is the DERIVATION of the boolean.

**Asked of the owner.** Declare the numeric per-action approval floor, or declare that the
operand is the catalogue's `approval_requirement` tier rather than a monetary threshold.
Under the current fixture the two readings differ: at a $25.00 `per_action_max` and a $25.00
floor, no admissible `refund.create` effect is ever above the floor, and row 2 is
unreachable for the whole S1 catalogue.


**OWNER RESOLUTION — `OWNER CLARIFICATION — ACCEPTED`.** v1.3.3 erratum **APF-01**.
`51 §3.7` declares `degraded_per_action_approval_floor_monetary` = **USD 20.00**, compared
**strictly** against `effect.request.exposure.total_exposure`; `30 §5.1a` specifies the
boundary, prints the reachable band `$20.01 … $25.00`, and records why the `$25.00`
`per_action_max` is a different quantity of a different kind. **The boolean operand is
removed**, not renamed: `PrecedenceOperands` now carries `totalExposure: Money` and
`isAboveDegradedApprovalFloor` is the one comparison site in `src/`. No TEST-ONLY seam
re-admits it. The hand-authored disposition table still stands, over the same 72 rows.
Control artifact **class 3**'s `content_hash` moves and a signature is owed, undischarged.
`S1H-owner-resolution.md §1`.

---

## S1H-C2 — `30 §5.6`'s three "Entered when" conditions are not disjoint as written

**Disposition: READING SELECTED — the stricter one.**

`30 §5.6`'s table:

| State | Entered when |
|---|---|
| `NORMAL` | Mirror acknowledging within threshold |
| `UNCORROBORATED_STALL` | Control plane observes the mirror unreachable; **no valid, unexpired `MirrorInputStallSignal` is held** |
| `CORROBORATED_DEGRADED` | The control plane holds a **valid, signed, unexpired `MirrorInputStallSignal`** issued by the audit plane |

Read as three independent predicates, the combination *"mirror acknowledging AND a valid
signal held"* satisfies BOTH row 1 and row 3, and the table declares no precedence — which
is the defect class AUD-05 raised one level up and which `30 §5.1` item 4 was rewritten to
remove.

**Reading selected.** The mirror observation is the OUTER discriminator and the signal is
the INNER one, which is the only reading under which the three rows are mutually exclusive
and exhaustive:

```
acknowledging                      → NORMAL
unreachable, no fresh valid signal → UNCORROBORATED_STALL
unreachable, fresh valid signal    → CORROBORATED_DEGRADED
```

**Why it is the safe choice, and why it changes no authority.** It cannot reach the relaxed
state on the signal alone. And `22 §3.1`'s table gives precedence row 3 *"Dispatch"* in
`NORMAL` and *"Dispatch, tagged `DISPATCHED_UNMIRRORED`"* in `CORROBORATED_DEGRADED` — so
the contested combination dispatches under either reading, and the choice is about the TAG
and the incident, not about eligibility.

**The residual, stated.** Under this reading, a control plane holding a fresh valid signal
while declaring nothing resolves to `NORMAL`, and a row-3 dispatch there carries no tag. If
the audit plane published an interval covering it, that is an `I17f(c)` exposure whose only
detector is `I8`. `resolveMirrorState` reports the combination as the
`SIGNAL_HELD_WITHOUT_DECLARATION` anomaly, which is `I17f(b)`'s own condition, and
`i17f-attestation-divergence.test.ts` case C exercises it.


**OWNER RESOLUTION — `OWNER CLARIFICATION — ACCEPTED, CONSERVATIVE PARTITION`.** Checked
against `§17`'s requirement rather than accepted on the argument: the contested combination
differs between the two readings in exactly one output field, `requiresUnmirroredTag`, and in
**no** disposition and **no** matched row — which `vc-a2-inversion.test.ts` already asserts
over all 24 operand combinations, because `36 §6` makes `CORROBORATED_DEGRADED` "as `NORMAL`,
with every dispatch tagged". **No observable authority outcome differs, so no counterexample
exists and access is not broadened.** The `SIGNAL_HELD_WITHOUT_DECLARATION` residual is
unchanged and still reported. `S1H-owner-resolution.md §2`.

---

## S1H-C3 — `I63(b)`'s "all records" and the status of a revoked override

**Disposition: READING SELECTED — the fail-closed one.**

Registry `I63(b)`: *"over any rolling 30-day window per company, the count, cumulative
hours, cumulative effects and cumulative monetary exposure of **all** `DegradedModeOverride`
records are each within the limits declared in `51 §3.6`."*

`30 §5.7.2`'s status set includes `REVOKED` and `EXPIRED`, and nothing exempts either from
the aggregate.

**Implemented.** The aggregate counts every record, whatever its status. `REVOKED` and
`EXPIRED` overrides continue to consume the rolling window, and `degraded_mode_override`
is append-only so a record cannot leave the population.

**Why.** The literal reading of "all". And the fail-closed reading of a consumption
budget: spending it and then revoking the instrument does not refund it. The opposite
reading would make revocation an evasion route — grant, consume, revoke, repeat — which is
exactly the composition `30 §5.7.2` item 10 bounds.


**OWNER RESOLUTION — `DIRECT ARCHITECTURE REQUIREMENT`.** `I63(b)` says "all" and
`30 §5.7.2`'s status set exempts neither `REVOKED` nor `EXPIRED`. Unchanged by v1.3.3.
`S1H-owner-resolution.md §3`.

---

## S1H-C4 — the S1G journal-immutability guard had a hole

**Disposition: DEFECT FOUND AND CLOSED. No owner decision required.**

`0007`'s `effect_journal_immutable_except_mirrored_at` compares an EXPLICIT column list
with `mirrored_at` normalised away. `0008` added `attested_max_journal_seq`,
`attested_row_count` and `attested_head_hash` and **did not extend that list**. An `UPDATE`
touching only those three columns therefore passed the outer
`(NEW.*) IS DISTINCT FROM (OLD.*)` test, compared EQUAL on the inner list, and was allowed.

**The attested prefix of a chained journal row was mutable in the control database** —
the rewrite `I41` and `30 §5.5` case 5 exist to make impossible.

**Closed in `0009`.** The comparison is now over every column with `mirrored_at` removed
(`to_jsonb(NEW) - 'mirrored_at'`), so the guard is total by construction and a future
`ALTER TABLE` cannot narrow it by omission. Strictly more refusing than the accepted
trigger: the one permitted update is still permitted, and every previously refused update
is still refused. `mirror-journal-rows.test.ts` carries the regression tests.


**OWNER RESOLUTION — `DEFECT FOUND AND REPAIRED; OWNER ACCEPTED SUBJECT TO REGRESSION`.**
`§18`'s four requirements are each verified: the attestation fields are immutable,
`mirrored_at` remains the one permitted narrow mutation, direct PostgreSQL `UPDATE` attacks
fail, and the S1G chain / `VC-A3` / attestation suites are green. **Not reverted**, per `§18`.
v1.3.3 adds no column to `effect_journal`, so the repair is unaffected.
`S1H-owner-resolution.md §4`.

---

## S1H-C5 — `last_attestation_received_at` has no declared nullability

**Disposition: IMPLEMENTATION DECLARATION.**

`30 §5.7.1` prints `MirrorInputStallSignal` without nullability markers on any field. A
stall declared before the company's first attestation has ever arrived has no instant to
report for `last_attestation_received_at`.

**Implemented.** The field is NULLABLE, and NULL means exactly one thing: no attestation
has ever been received from this company. The alternative — filling it with a fabricated
timestamp inside a SIGNED artifact — is worse.

**It is NOT paired with `last_attestation_seq = 0`.** An attestation over an empty journal
legitimately reports `max_journal_seq = 0` WITH a real arrival instant, which is `30 §5.4`'s
*"the empty attestation is the entire point"*. An earlier draft bound the two with a CHECK
and that CHECK was wrong; it is removed.


**OWNER RESOLUTION — `IMPLEMENTATION DETAIL — NON-SEMANTIC`.** Unchanged by v1.3.3.
`S1H-owner-resolution.md §5`.

---

## S1H-C6 — `30 §5.7.1`'s freshness conjunction admits a future-dated signal

**Disposition: ADDITION — strictly stricter than the declared rule.**

`30 §5.7.1`'s freshness rule is *"`now() − signal.observed_at ≤ max_age` **and**
`now() < signal.expires_at`"*. If `observed_at > now()`, the first conjunct's left side is
NEGATIVE, which satisfies `≤ max_age`, and the second holds. **The declared conjunction
admits a signal whose observation instant has not arrived.**

**Implemented.** `isCorroborationFresh` REFUSES `observed_at > now`, and
`verifyCorroborationSignal` reports `SIGNAL_FUTURE_DATED`.

**Why this is not an invented quantity.** No tolerance is introduced — nothing is compared
against a made-up window. A REFUSAL is added, and a refusal cannot unlock authority, so it
cannot move any row of `VC-A2`'s inversion table in the permissive direction. Recorded here
rather than folded in silently.

**Note on the threat model.** A future-dated signal must be signed by the audit plane's
private key, so it cannot be produced by a compromised control plane. The realistic cause
is clock skew between the two hosts, and `36 §6`'s clock-skew row makes the database clock
authoritative. The refusal is therefore conservative rather than adversarially necessary.


**OWNER RESOLUTION — `OWNER CLARIFICATION — ACCEPTED`.** A refusal cannot unlock authority,
so it cannot move any row of `VC-A2`'s inversion table in the permissive direction. No
tolerance quantity was introduced. Unchanged by v1.3.3. `S1H-owner-resolution.md §5`.

---

## S1H-C7 — "approval-bearing effects evaluate at rows 3 or 5" is imprecise

**Disposition: READING SELECTED — the operative half.**

`30 §5.1` item 4 closes with *"**Approval-bearing effects evaluate at rows 3 or 5 once
approved**; the approval gate is `26 §12`'s concern and is not re-litigated here."*
`phase2-v1.2-remediation-ledger.md` states the applied change more precisely: *"an effect
carrying a recorded approval is evaluated at row 3 or row 5, **never row 2**, because the
approval floor's purpose is satisfied."*

"Rows 3 or 5" is not exhaustive. An above-floor, APPROVED, COMPENSABLE, DISCRETIONARY
effect cannot reach row 3 — row 3 requires a live clock — so it falls to row 4 and
suspends.

**Implemented.** "Never row 2" is the operative half and is what row 2's predicate encodes:
`aboveApprovalFloor && !clockBearing && !hasRecordedApproval`. An approved effect then
evaluates at row 3, 4 or 5 by its class, and `first-match-order.test.ts` asserts the row-4
case explicitly.


**OWNER RESOLUTION — `OWNER CLARIFICATION — ACCEPTED`.** "Never row 2" is the operative half,
and it is now asserted at the declared floor as well:
`dispatch-precedence-approval-floor.test.ts` runs an above-floor APPROVED discretionary
COMPENSABLE effect and asserts row 4. `S1H-owner-resolution.md §5`.

---

## S1H-C8 — `STORE_WRITE_REJECTED` has no declared derivation rule

**Disposition: ARCHITECTURE ABSENT. Owner decision required. Leg reported PARTIAL.**

`30 §5.7.1` declares `reason enum { ATTESTATION_STALL, PUSH_PATH_UNREACHABLE,
STORE_WRITE_REJECTED }` and declares no rule for when the audit plane issues the third.

The one candidate reading is insert-quota saturation, and it is EXPLICITLY FORBIDDEN as a
mode transition:

- `30 §5.1` item 5: *"**Audit-store saturation is an incident, not a mode change
  (I17c).**"*
- `30 §5.6`'s reachability table: *"Audit insert quota saturated (`I17c`) | Yes | Yes | Yes
  | **Yes**, but `§5.1` item 5 declares saturation *an incident, not a mode change*."*

**Implemented.** `observeStall` derives `ATTESTATION_STALL` from the audit plane's own
attestation holdings and reports the audit store's own reachability observation. It NEVER
returns `STORE_WRITE_REJECTED`. The enum member is accepted on the verification path — a
signal carrying it verifies if it is genuinely signed and fresh — so if the owner declares
a derivation later, no control-side change is needed.

`vc-a2d-signal-authenticity.test.ts` asserts that a saturated quota produces
`AUDIT_QUOTA_SATURATED` and NO signal.

**Asked of the owner.** Declare when `STORE_WRITE_REJECTED` is issued, or delete the enum
member.


**OWNER RESOLUTION — `OWNER CLARIFICATION — ACCEPTED`.** v1.3.3 erratum **SWR-01**. The enum
member is KEPT and `30 §5.7.1a` gives it a **closed ten-condition AUDIT-OWNED derivation**
over one semantic failure class, `AUDIT_STORE_WRITE_UNAVAILABLE`. The architecture declares
the semantic class; `src/audit/storeWriteAvailability.ts` and `A0004` declare the PostgreSQL
mapping as a closed three-code allowlist (`53100`, `58030`, `25006`), each justified, with
twenty-one codes excluded by name and **fail-closed for everything else**. **Quota saturation
remains incident-only and never changes mirror mode** — asserted directly. `A0003` adds the
audit-owned, append-only `audit_store_write_failure`, which the control plane cannot read or
write. All five of `§8`'s controls discriminate, including the mandatory POSITIVE one.
`S1H-owner-resolution.md §6`.

---

## S1H-C9 — the declared byte order for the three new journal row kinds

**Disposition: IMPLEMENTATION DECLARATION.**

`30 §5.7` requires the control-side declaration to be an `AUDIT_MIRROR_DEGRADED` journal
row. `30 §5.7.1` requires `signal_id` to be *"recorded in the journal on consumption"*.
`30 §5.7.2` item 7 requires override creation, grant, second approval, each cap decrement,
exhaustion, expiry and revocation to be journaled, *"each as its own row"*.

**None of those passages declares a field order**, and `30 §5.3` requires the order to be
*"declared per row kind, in the specification"*. 0008 was in the same position for
`JOURNAL_ATTESTATION` and declared its order for the first time.

**Implemented.** The three orders are declared in `S1H-contract.md §4` and are the
specification. They are transcribed independently on the control server (`0009`), on the
audit server (`A0002`) and a fourth time by hand in `tests/support/jcs1Oracle.ts`, which is
the judge. One of the three new row-kind identifiers is the architecture's own —
`AUDIT_MIRROR_DEGRADED`, named in `30 §5.7` and `§5.1` item 5. The other two,
`MIRROR_CORROBORATION_CONSUMED` and `DEGRADED_MODE_OVERRIDE_EVENT`, are implementation
identifiers for obligations the architecture states without naming.

**The same applies to the seven `override_event` values.** `30 §5.7.2` item 7 enumerates the
EVENTS — "creation, grant, second approval, each cap decrement, exhaustion, expiry and
revocation" — and names none of them. S1H declares `REQUESTED`, `GRANTED`,
`SECOND_APPROVED`, `ALLOWANCE_TAKEN`, `EXHAUSTED`, `EXPIRED`, `REVOKED`. The cap-decrement
event is `ALLOWANCE_TAKEN` and deliberately not `CLAIMED`: `25 §7` layer 4's outbox owns that
literal, and `local-authorisation-boundary.test.ts` forbids it in `src/` until `I36` exists.
`§18` of the S1H mandate calls the thing being taken "the pre-dispatch override allowance",
and the identifier says exactly that.


**OWNER RESOLUTION — `IMPLEMENTATION DETAIL — NON-SEMANTIC`.** v1.3.3 adds no journal row
kind and no journal column, so no declared order moved. `S1H-owner-resolution.md §5`.

---

## S1H-C10 — the mirror-lag and prolonged-unreachability thresholds are undeclared

**Disposition: ARCHITECTURE ABSENT. Owner decision required. Leg NOT IMPLEMENTED.**

`30 §5.1` item 5: *"Mirror lag above threshold raises `AUDIT_MIRROR_DEGRADED` at
**CRITICAL** urgency, owner-visible immediately. **Mirror unreachable beyond a longer
threshold halts all classes including REVERSIBLE** — the point at which the company
stops."* `24 §3` K11 and `35 §12.1` repeat both in the same words.

**Neither threshold has a declared numeric value anywhere in v1.3.2.** `51` declares
`attestation_cadence` (5 minutes), `k` (3), the anchor interval (60 minutes), the signal
`max_age` (5 minutes) and every override quantity — and no mirror-lag threshold and no
prolonged-unreachability threshold.

**Consequence, and what was NOT built.** The FULL-HALT POSTURE — all classes halting,
including REVERSIBLE — is not implemented, because its trigger operand is an undeclared
quantity and `§42` forbids inventing one. The three-state machine and the five-row
precedence do not depend on either threshold: `30 §5.6` enters `UNCORROBORATED_STALL` on an
OBSERVATION ("control plane observes the mirror unreachable"), not on a threshold, and the
precedence rows are evaluated inside the state.

So the halt posture is a FOURTH behaviour outside the three states, and `S1H-result.md §16`
reports it OPEN.

**Asked of the owner.** Declare the mirror-lag threshold and the prolonged-unreachability
threshold, with their kinds, or state that the halt posture is a later slice.


**OWNER RESOLUTION — `OWNER CLARIFICATION — ACCEPTED`.** v1.3.3 errata **MLT-01** and
**FHT-01**. `51 §3.8` declares `mirror_lag_critical_threshold` = **PT15M** and
`audit_unreachable_full_halt_threshold` = **PT30M**, both **inclusive at the threshold**, with
declared operands and — for the second — declared timer start and reset semantics: the open
`AUDIT_MIRROR_DEGRADED` declaration, at most one per company, starting on open and resetting
only on close. `30 §5.1a` specifies the **FULL-HALT POSTURE** as a fourth behaviour over the
three states, and resolves the override composition from item 5's own two sentences — rows 3
and 4 restorable, rows 1, 2 and **5** not.

**`§3`'s and `§16`'s STOP conditions were both checked and neither triggers.** The
architecture defines the timer's start and reset (the declaration's lifecycle, plus
`mirror_declaration_one_open_per_company`), and item 5 does state that the override reaches
the halt. Both are recorded with the quoted text in `S1H-owner-resolution.md §7`. **No
override quantity moved.** The 15-minute threshold is **aligned** with `cadence × k` and the
concepts are **not merged**; a timer alone cannot create `CORROBORATED_DEGRADED`, asserted
over the durable tables.

---

## S1H-C11 — whether an override applies in `NORMAL` and `CORROBORATED_DEGRADED`

**Disposition: READING SELECTED.**

`30 §5.1` item 5: *"The only escape from either the halt or `UNCORROBORATED_STALL`'s row-3
suspension is a `DegradedModeOverride` [...] An override restores precedence rows 3 and 4
only, never rows 1 or 2."* `22 §3.1`: *"Rows 3 and 4 are the only rows a
`DegradedModeOverride` can restore."*

The scope rule is stated over ROWS, not over states. Row 4 suspends in ALL THREE states
(`22 §3.1`), so an override scoped to row 4 has something to restore in `NORMAL` too.

**Implemented.** The override applies to rows 3 and 4 whenever it is `ACTIVE`, in-window
and in scope, in ANY state. In `NORMAL` and `CORROBORATED_DEGRADED` this is a no-op for row
3, which already dispatches; for row 4 it restores dispatch.

**And every override dispatch is tagged**, in any state, because `30 §5.7.2` item 5 says so
without qualification: *"Every dispatch under it is tagged `DISPATCHED_UNMIRRORED` **and**
carries `override_id`."*

**The tension this creates, stated rather than resolved.** In `UNCORROBORATED_STALL` no
published stall interval is KNOWN to exist — the signal is what proves one does — so an
override dispatch tagged `DISPATCHED_UNMIRRORED` there could violate `I17f(a)`, which
requires *"a concurrent audit-plane `MIRROR_INPUT_STALL` interval covering its dispatch
timestamp"*. In the two-sided-outage case the override exists for, the audit plane may have
published nothing at all. Item 5 is unqualified, so it is implemented as written and the
tension is reported in `S1H-result.md §16`. It is not reachable in S1H, because nothing is
dispatched and nothing is tagged.


**OWNER RESOLUTION — `OWNER CLARIFICATION — ACCEPTED`**, and the item-5 / `I17f(a)` tension
remains a **DEFERRED RESIDUAL**, reported rather than resolved. v1.3.3 resolves only the
posture leg — which rows an override reaches inside the FULL-HALT POSTURE — and does not
touch which states it applies in. Not reachable at S1H, because nothing is dispatched and
nothing is tagged. `S1H-owner-resolution.md §8`.

---

## S1H-C12 — `I8`'s additive verification list cannot be populated at S1

**Disposition: ARCHITECTURE ITSELF DEFERS IT. No owner decision required.**

`36 §9` VC-A2e requires asserting that every dispatch under an override *"appears in the
next `I8` verification list"*. `30 §5.7.2` item 6 says the same.

`37` S1 answers it: *"**`I8` proves nothing at S1.** All four action classes run against
mock adapters, so there is no vendor side for the inverse sweep to enumerate. [...] at S1
those two residuals have no operative detector at all."*

**Not implemented, and not simulated.** The clause is reported OPEN in
`S1H-result.md §16`, and `no-dispatch-boundary.test.ts` asserts the absence of any vendor
read, sweep or adapter in `src/` so the OPEN status cannot drift into a silent claim.


**OWNER RESOLUTION — `DEFERRED RESIDUAL`.** The architecture itself defers it: `37` S1 says
"`I8` proves nothing at S1". Not implemented and not simulated, and
`no-dispatch-boundary.test.ts` asserts the absences so the OPEN status cannot drift into a
silent claim. Unchanged by v1.3.3. `S1H-owner-resolution.md §9`.
